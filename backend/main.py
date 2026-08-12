import os
import re
import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Tuple, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
import sqlglot
import sqlglot.expressions as exp
import chromadb
from chromadb.utils import embedding_functions
from groq import Groq
from dotenv import load_dotenv

DB_URI = "sqlite:///./app.db"
CHROMA_DIR = "./chroma_db"

# Load environment variables
load_dotenv() 

app = FastAPI(
    title="QueryMind AI Production Engine",
    description="Text-to-SQL Engine with Query Classification, ChromaDB Few-Shot RAG, AST Guardrails & Self-Healing",
    version="0.4.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = create_engine(DB_URI, connect_args={"check_same_thread": False})
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

@app.on_event("startup")
def startup_event():
    with engine.connect() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS query_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt TEXT NOT NULL,
                sql_query TEXT,
                status TEXT,
                latency_ms REAL,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS schema_metadata (
                table_name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                description TEXT,
                is_sensitive BOOLEAN DEFAULT 0,
                PRIMARY KEY (table_name, column_name)
            )
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """))
        connection.commit()

        # Seed default config values if they don't exist
        defaults = {
            "block_write_operations": "true",
            "default_row_limit": "100",
            "restricted_tables": "",
            "model_provider": "groq",
            "model_name": "llama-3.1-8b-instant",
            "temperature": "0.0",
            "max_tokens": "1024",
            "sql_dialect": "sqlite",
        }
        for key, value in defaults.items():
            connection.execute(text(
                "INSERT OR IGNORE INTO app_config (key, value) VALUES (:key, :value)"
            ), {"key": key, "value": value})
        connection.commit()

# ==========================================
# Query Classification Setup
# ==========================================

class QueryCategory(str, Enum):
    SELECT_SIMPLE = "SELECT_SIMPLE"       # Basic SELECT with filtering, ordering, limiting
    SELECT_AGGREGATE = "SELECT_AGGREGATE" # Uses COUNT, SUM, AVG, GROUP BY, HAVING
    SELECT_JOIN = "SELECT_JOIN"           # Combines multiple tables via JOINs
    SELECT_TEMPORAL = "SELECT_TEMPORAL"   # Date/time filtering, time series, or trends
    UNSUPPORTED = "UNSUPPORTED"           # Destructive operations (DELETE/DROP) or invalid prompts

# Regex guardrail to catch write/mutation commands fast
FORBIDDEN_KEYWORDS_REGEX = re.compile(
    r"\b(delete|drop|update|insert|alter|truncate|create|grant|revoke)\b",
    re.IGNORECASE
)

def check_security_guardrail(prompt: str) -> bool:
    """Returns True if prompt contains destructive modification keywords."""
    return bool(FORBIDDEN_KEYWORDS_REGEX.search(prompt))


def classify_query(user_prompt: str) -> Tuple[QueryCategory, str]:
    """
    Classifies an input text prompt into one of the QueryCategory types.
    Fast-rejects destructive operations before calling LLMs.
    """
    # 1. Immediate Rule-Based Security Guardrail
    if check_security_guardrail(user_prompt):
        return (
            QueryCategory.UNSUPPORTED,
            "Query contains prohibited data modification commands (DELETE, DROP, UPDATE, etc.)."
        )

    # 2. LLM-Based Categorization
    classification_prompt = f"""You are an expert SQL Query Classifier. Analyze the user's natural language request and assign it to EXACTLY ONE of the following categories:SELECT_SIMPLE: Basic retrieval of records (e.g., "List all active products", "Show customers from NY").SELECT_AGGREGATE: Involves math, summaries, totals, averages, or groupings (e.g., "Count total orders", "Average sales per category").SELECT_JOIN: Involves combining 2+ tables (e.g., "List products with their category names", "Show orders with customer info").SELECT_TEMPORAL: Involves date/time filtering or trends (e.g., "Orders placed in 2024", "Monthly sales").UNSUPPORTED: Anything that asks to modify database records or is completely out of scope.Respond with ONLY the exact category name (e.g., SELECT_AGGREGATE). Do not output punctuation or extra text.User Request: "{user_prompt}"Category:"""

    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": classification_prompt}],
            temperature=0.0
        )
        raw_category = response.choices[0].message.content.strip().upper()
        
        # Match response to Enum
        for cat in QueryCategory:
            if cat.value in raw_category:
                return cat, f"Classified as {cat.value}"
                
        return QueryCategory.SELECT_SIMPLE, "Defaulted to SELECT_SIMPLE"

    except Exception as e:
        # Fallback to basic select on API errors
        return QueryCategory.SELECT_SIMPLE, f"Classification API error fallback: {str(e)}"


# ==========================================
# ChromaDB Initialization
# ==========================================

chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")

collection = chroma_client.get_or_create_collection(
    name="sql_examples",
    embedding_function=sentence_transformer_ef
)


def retrieve_few_shot_examples(user_prompt: str, top_k: int = 3) -> List[Dict[str, str]]:
    """Queries ChromaDB to fetch the top-k semantically similar Question -> SQL pairs."""
    results = collection.query(
        query_texts=[user_prompt],
        n_results=top_k
    )

    examples = []
    if results and results.get("documents") and results["documents"][0]:
        questions = results["documents"][0]
        metadatas = results["metadatas"][0]

        for q, meta in zip(questions, metadatas):
            examples.append({
                "question": q,
                "sql": meta["sql"]
            })
    return examples


# ==========================================
# Schema Context Helper
# ==========================================

def get_database_schema_context() -> str:
    inspector = inspect(engine)
    schema_lines = []

    # Exclude internal admin tables
    internal_tables = {"query_logs", "schema_metadata", "app_config"}

    # Load existing metadata into a lookup dict
    meta_lookup = {}
    try:
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT table_name, column_name, description, is_sensitive FROM schema_metadata"))
            for r in rows:
                meta_lookup[(r[0], r[1])] = {"description": r[2] or "", "is_sensitive": bool(r[3])}
    except Exception:
        pass

    for table_name in inspector.get_table_names():
        if table_name in internal_tables:
            continue
        schema_lines.append(f"Table: {table_name}")
        columns = inspector.get_columns(table_name)
        
        col_desc = []
        for col in columns:
            col_name = col["name"]
            meta = meta_lookup.get((table_name, col_name), {})
            
            # Skip sensitive columns entirely from LLM context
            if meta.get("is_sensitive", False):
                continue
                
            desc_part = f" - {meta['description']}" if meta.get("description") else ""
            col_desc.append(f"{col_name} ({col['type']}){desc_part}")
            
        schema_lines.append(f"  Columns: {', '.join(col_desc)}")
        
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            schema_lines.append(
                f"  FK: {table_name}.{fk['constrained_columns'][0]} -> {fk['referred_table']}.{fk['referred_columns'][0]}"
            )
        schema_lines.append("")

    return "\n".join(schema_lines)


# ==========================================
# Config Helper
# ==========================================

def get_config(key: str, default: str = "") -> str:
    """Read a single config value from the app_config table."""
    try:
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT value FROM app_config WHERE key = :key"),
                {"key": key}
            ).fetchone()
            return row[0] if row else default
    except Exception:
        return default


# ==========================================
# AST Security & Guardrails (sqlglot)
# ==========================================

def validate_and_sanitize_sql(raw_sql: str, default_limit: int = None) -> Tuple[bool, str, str]:
    if default_limit is None:
        default_limit = int(get_config("default_row_limit", "100"))

    sql_dialect = get_config("sql_dialect", "sqlite")

    try:
        expression = sqlglot.parse_one(raw_sql, read=sql_dialect)
    except sqlglot.errors.ParseError as pe:
        return False, raw_sql, f"SQL Syntax Parse Error: {str(pe)}"

    if not expression or not isinstance(expression, exp.Select):
        return False, raw_sql, "Security Violation: Query must be a SELECT statement."

    forbidden_list = [exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create]
    if hasattr(exp, "Alter"): forbidden_list.append(exp.Alter)
    if hasattr(exp, "AlterTable"): forbidden_list.append(exp.AlterTable)
    if hasattr(exp, "TruncateTable"): forbidden_list.append(exp.TruncateTable)

    # Check restricted tables
    restricted_raw = get_config("restricted_tables", "")
    restricted_set = {t.strip().lower() for t in restricted_raw.split(",") if t.strip()}
    if restricted_set:
        for table_node in expression.find_all(exp.Table):
            if table_node.name.lower() in restricted_set:
                return False, raw_sql, f"Security Violation: Access to table '{table_node.name}' is restricted."

    for node in expression.walk():
        if isinstance(node, tuple(forbidden_list)):
            node_name = getattr(node, "key", str(type(node).__name__)).upper()
            return False, raw_sql, f"Security Violation: Non-read operation detected ({node_name})."

    if expression.find(exp.Limit) is None:
        expression = expression.limit(default_limit)

    return True, expression.sql(dialect=sql_dialect), ""


# ==========================================
# Schemas
# ==========================================

class QueryRequest(BaseModel):
    prompt: str = Field(..., example="Show top 3 buyers in New York by total spending")

class QueryResponse(BaseModel):
    query_category: QueryCategory
    sql_query: str
    retrieved_examples: List[Dict[str, str]]
    original_failed_sql: Optional[str] = None
    healing_error_message: Optional[str] = None
    execution_time_ms: float
    row_count: int
    was_healed: bool
    data: List[Dict[str, Any]]
    summary: str


class QueryLog(BaseModel):
    id: int
    prompt: str
    sql_query: Optional[str]
    status: str
    latency_ms: Optional[float]
    error_message: Optional[str]
    created_at: str

class ExampleRequest(BaseModel):
    question: str
    sql: str

class ExampleResponse(BaseModel):
    id: str
    question: str
    sql: str

class SchemaColumnMeta(BaseModel):
    table_name: str
    column_name: str
    column_type: str
    description: Optional[str] = ""
    is_sensitive: bool = False

class SchemaMetadataUpdate(BaseModel):
    table_name: str
    column_name: str
    description: Optional[str] = ""
    is_sensitive: bool = False

# ==========================================
# API Helpers & Main Endpoint
# ==========================================

def log_query(prompt: str, sql_query: str = None, status: str = "SUCCESS", latency_ms: float = None, error_message: str = None):
    try:
        with engine.connect() as connection:
            connection.execute(text("""
                INSERT INTO query_logs (prompt, sql_query, status, latency_ms, error_message)
                VALUES (:prompt, :sql_query, :status, :latency_ms, :error_message)
            """), {
                "prompt": prompt,
                "sql_query": sql_query,
                "status": status,
                "latency_ms": latency_ms,
                "error_message": error_message
            })
            connection.commit()
    except Exception as e:
        print(f"Failed to log query: {e}")

def call_llm(messages: List[Dict[str, str]]) -> str:
    model_name = get_config("model_name", "llama-3.1-8b-instant")
    temperature = float(get_config("temperature", "0.0"))
    max_tokens = int(get_config("max_tokens", "1024"))

    response = client.chat.completions.create(
        model=model_name,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens
    )
    raw = response.choices[0].message.content.strip()
    return raw.replace("```sql", "").replace("```", "").strip()


def generate_summary(user_prompt: str, data: List[Dict[str, Any]]) -> str:
    if not data:
        return "No records were returned for this query."
    
    summary_prompt = f"Question: '{user_prompt}'\nSample Data: {data[:5]}\nProvide a concise 1-2 sentence summary."
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.3
    )
    return response.choices[0].message.content.strip()


@app.post("/query", response_model=QueryResponse)
def execute_text_to_sql(request: QueryRequest):
    # Step 0: Query Classification & Fast Rejection Guardrail
    category, reasoning = classify_query(request.prompt)
    if category == QueryCategory.UNSUPPORTED:
        log_query(request.prompt, status="ERROR", error_message=reasoning)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query Rejected: {reasoning}"
        )

    # Step 1: Few-Shot RAG Retrieval from ChromaDB
    retrieved_examples = retrieve_few_shot_examples(request.prompt, top_k=3)
    
    examples_str = ""
    if retrieved_examples:
        examples_str = "Here are relevant example questions and their target SQL queries:\n\n"
        for i, ex in enumerate(retrieved_examples, 1):
            examples_str += f"Example {i}:\nQuestion: {ex['question']}\nSQL: {ex['sql']}\n\n"

    # Step 2: Construct Refined System Prompt with Category Context
    dynamic_schema = get_database_schema_context()
    system_instruction = f"""You are an expert SQLite Text-to-SQL engine. Return ONLY executable SQL. No markdown, no ```sql, no explanations.SCHEMA:{dynamic_schema}{examples_str}RULES:QUERY TYPE: The user query is classified as {category.value}.
DIALECT: SQLite only. Use strftime('%Y', c) for years, strftime('%Y-%m', c) for months. No DATE_TRUNC, EXTRACT, or ILIKE. Use LIKE.
COLUMNS: Never use 'SELECT *'. Explicitly list required columns.AGGREGATIONS: Pair SUM/COUNT/AVG with GROUP BY. Filter aggregates using HAVING.JOINS: Use LEFT JOIN + 'WHERE fk IS NULL' for missing/unmatched records.ALIASES: Use explicit descriptive aliases (e.g., total_orders, total_spent, avg_price)."""

    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": request.prompt}
    ]

    # Step 3: Generate & Validate SQL
    raw_sql = call_llm(messages)
    is_valid, sanitized_sql, ast_error = validate_and_sanitize_sql(raw_sql)
    if not is_valid:
        log_query(request.prompt, sql_query=raw_sql, status="ERROR", error_message=ast_error)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"AST Security Violation: {ast_error}"
        )

    was_healed = False
    original_failed_sql = None
    healing_error_message = None
    start_time = time.perf_counter()
    rows = []

    # Step 4: Execution & Self-Healing Loop
    try:
        with engine.connect() as connection:
            result = connection.execute(text(sanitized_sql))
            columns = result.keys()
            rows = [dict(zip(columns, row)) for row in result.fetchall()]

    except SQLAlchemyError as primary_err:
        was_healed = True
        original_failed_sql = sanitized_sql
        healing_error_message = str(primary_err)
        
        messages.append({"role": "assistant", "content": sanitized_sql})
        messages.append({
            "role": "user", 
            "content": f"The query failed with SQLite error: '{healing_error_message}'. Fix it and return raw SQL."
        })

        healed_raw = call_llm(messages)
        is_valid_heal, healed_sql, heal_ast_error = validate_and_sanitize_sql(healed_raw)

        if not is_valid_heal:
            log_query(request.prompt, sql_query=healed_raw, status="ERROR", error_message=f"Healing AST invalid: {heal_ast_error}")
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Self-healing produced invalid AST: {heal_ast_error}"
            )

        try:
            with engine.connect() as connection:
                result = connection.execute(text(healed_sql))
                columns = result.keys()
                rows = [dict(zip(columns, row)) for row in result.fetchall()]
                sanitized_sql = healed_sql
        except SQLAlchemyError as healed_err:
            log_query(request.prompt, sql_query=healed_sql, status="ERROR", error_message=f"Healing failed: {str(healed_err)}")
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Self-Healing Failed: {str(healed_err)}"
            )

    execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
    summary = generate_summary(request.prompt, rows)

    log_query(request.prompt, sql_query=sanitized_sql, status="SUCCESS", latency_ms=execution_time_ms, error_message=healing_error_message if was_healed else None)

    return QueryResponse(
        query_category=category,
        sql_query=sanitized_sql,
        retrieved_examples=retrieved_examples,
        original_failed_sql=original_failed_sql,
        healing_error_message=healing_error_message,
        execution_time_ms=execution_time_ms,
        row_count=len(rows),
        was_healed=was_healed,
        data=rows,
        summary=summary
    )


@app.get("/logs", response_model=List[QueryLog])
def get_query_logs():
    try:
        with engine.connect() as connection:
            result = connection.execute(text("SELECT id, prompt, sql_query, status, latency_ms, error_message, created_at FROM query_logs ORDER BY created_at DESC LIMIT 100"))
            columns = result.keys()
            logs = [dict(zip(columns, row)) for row in result.fetchall()]
            return logs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/examples", response_model=List[ExampleResponse])
def get_examples():
    results = collection.get()
    examples = []
    if results and results.get("ids"):
        ids = results["ids"]
        documents = results["documents"]
        metadatas = results["metadatas"]
        for i in range(len(ids)):
            examples.append({
                "id": ids[i],
                "question": documents[i],
                "sql": metadatas[i]["sql"] if metadatas[i] and "sql" in metadatas[i] else ""
            })
    return examples

@app.post("/examples", response_model=ExampleResponse)
def add_example(request: ExampleRequest):
    new_id = str(uuid.uuid4())
    collection.add(
        documents=[request.question],
        metadatas=[{"sql": request.sql}],
        ids=[new_id]
    )
    return ExampleResponse(id=new_id, question=request.question, sql=request.sql)

@app.delete("/examples/{example_id}")
def delete_example(example_id: str):
    collection.delete(ids=[example_id])
    return {"status": "success", "id": example_id}


@app.get("/schema", response_model=List[SchemaColumnMeta])
def get_schema():
    """Return every table/column in the user DB, enriched with description & sensitivity from schema_metadata."""
    inspector = inspect(engine)
    # Exclude internal admin tables from the schema view
    internal_tables = {"query_logs", "schema_metadata", "app_config"}

    # Load existing metadata into a lookup dict
    meta_lookup: Dict[Tuple[str, str], Dict] = {}
    try:
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT table_name, column_name, description, is_sensitive FROM schema_metadata"))
            for r in rows:
                meta_lookup[(r[0], r[1])] = {"description": r[2] or "", "is_sensitive": bool(r[3])}
    except Exception:
        pass  # table may be empty on first run

    schema: List[Dict] = []
    for table_name in inspector.get_table_names():
        if table_name in internal_tables:
            continue
        for col in inspector.get_columns(table_name):
            col_name = col["name"]
            col_type = str(col["type"])
            meta = meta_lookup.get((table_name, col_name), {})
            schema.append({
                "table_name": table_name,
                "column_name": col_name,
                "column_type": col_type,
                "description": meta.get("description", ""),
                "is_sensitive": meta.get("is_sensitive", False),
            })
    return schema


@app.post("/schema/metadata")
def upsert_schema_metadata(request: SchemaMetadataUpdate):
    """Insert or update description / sensitivity flag for a specific column."""
    try:
        with engine.connect() as connection:
            # SQLite UPSERT via INSERT OR REPLACE
            connection.execute(text("""
                INSERT OR REPLACE INTO schema_metadata (table_name, column_name, description, is_sensitive)
                VALUES (:table_name, :column_name, :description, :is_sensitive)
            """), {
                "table_name": request.table_name,
                "column_name": request.column_name,
                "description": request.description,
                "is_sensitive": 1 if request.is_sensitive else 0,
            })
            connection.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/config")
def get_all_config():
    """Return all config key-value pairs as a dictionary."""
    try:
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT key, value FROM app_config")).fetchall()
            return {row[0]: row[1] for row in rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/config")
def update_config(updates: Dict[str, str]):
    """Bulk update config key-value pairs."""
    try:
        with engine.connect() as connection:
            for key, value in updates.items():
                connection.execute(text(
                    "INSERT OR REPLACE INTO app_config (key, value) VALUES (:key, :value)"
                ), {"key": key, "value": value})
            connection.commit()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8080, reload=True)