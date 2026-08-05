import os
import time
from typing import Any, Dict, List, Tuple, Optional
from fastapi import FastAPI, HTTPException, status
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
# Load the environment variables from the .env file
load_dotenv() 

app = FastAPI(
    title="QueryMind AI Production Engine",
    description="Text-to-SQL Engine with ChromaDB Few-Shot RAG, AST Guardrails & Self-Healing",
    version="0.3.0"
)

engine = create_engine(DB_URI, connect_args={"check_same_thread": False})
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# ==========================================
# ChromaDB Initialization
# ==========================================

chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
# Use standard default sentence transformer embedding or OpenAI embeddings
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

    for table_name in inspector.get_table_names():
        schema_lines.append(f"Table: {table_name}")
        columns = inspector.get_columns(table_name)
        col_desc = [f"{col['name']} ({col['type']})" for col in columns]
        schema_lines.append(f"  Columns: {', '.join(col_desc)}")
        
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            schema_lines.append(
                f"  FK: {table_name}.{fk['constrained_columns'][0]} -> {fk['referred_table']}.{fk['referred_columns'][0]}"
            )
        schema_lines.append("")

    return "\n".join(schema_lines)


DB_SCHEMA_CONTEXT = get_database_schema_context()


# ==========================================
# AST Security & Guardrails (sqlglot)
# ==========================================

def validate_and_sanitize_sql(raw_sql: str, default_limit: int = 100) -> Tuple[bool, str, str]:
    try:
        expression = sqlglot.parse_one(raw_sql, read="sqlite")
    except sqlglot.errors.ParseError as pe:
        return False, raw_sql, f"SQL Syntax Parse Error: {str(pe)}"

    if not expression or not isinstance(expression, exp.Select):
        return False, raw_sql, "Security Violation: Query must be a SELECT statement."

    forbidden_list = [exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create]
    if hasattr(exp, "Alter"): forbidden_list.append(exp.Alter)
    if hasattr(exp, "AlterTable"): forbidden_list.append(exp.AlterTable)
    if hasattr(exp, "TruncateTable"): forbidden_list.append(exp.TruncateTable)

    for node in expression.walk():
        if isinstance(node, tuple(forbidden_list)):
            node_name = getattr(node, "key", str(type(node).__name__)).upper()
            return False, raw_sql, f"Security Violation: Non-read operation detected ({node_name})."

    if expression.find(exp.Limit) is None:
        expression = expression.limit(default_limit)

    return True, expression.sql(dialect="sqlite"), ""


# ==========================================
# Schemas
# ==========================================

class QueryRequest(BaseModel):
    prompt: str = Field(..., example="Show top 3 buyers in New York by total spending")

class QueryResponse(BaseModel):
    sql_query: str
    retrieved_examples: List[Dict[str, str]]
    original_failed_sql: Optional[str] = None
    healing_error_message: Optional[str] = None
    execution_time_ms: float
    row_count: int
    was_healed: bool
    data: List[Dict[str, Any]]
    summary: str


# ==========================================
# API Endpoint
# ==========================================

def call_llm(messages: List[Dict[str, str]]) -> str:
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.0
    )
    raw = response.choices[0].message.content.strip()
    return raw.replace("```sql", "").replace("```", "").strip()


def generate_summary(user_prompt: str, data: List[Dict[str, Any]]) -> str:
    if not data:
        return "No records were returned for this query."
    
    summary_prompt = f"Question: '{user_prompt}'\nSample Data: {data[:5]}\nProvide a concise 1-2 sentence summary."
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.3
    )
    return response.choices[0].message.content.strip()


@app.post("/query", response_model=QueryResponse)
def execute_text_to_sql(request: QueryRequest):
    # Step 1: Few-Shot RAG Retrieval from ChromaDB
    retrieved_examples = retrieve_few_shot_examples(request.prompt, top_k=3)
    
    examples_str = ""
    if retrieved_examples:
        examples_str = "Here are relevant example questions and their target SQL queries:\n\n"
        for i, ex in enumerate(retrieved_examples, 1):
            examples_str += f"Example {i}:\nQuestion: {ex['question']}\nSQL: {ex['sql']}\n\n"

    system_instruction = f"""You are a strict SQLite text-to-SQL generator.
Output raw executable SQLite SQL ONLY. Do not wrap code in markdown.

Database Schema:
{DB_SCHEMA_CONTEXT}

{examples_str}
Instruction:
Translate the user's question into executable SQLite SQL using the schema and similar examples provided above.
"""

    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": request.prompt}
    ]

    # Step 2: Generate & Validate SQL
    raw_sql = call_llm(messages)
    is_valid, sanitized_sql, ast_error = validate_and_sanitize_sql(raw_sql)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"AST Security Violation: {ast_error}"
        )

    was_healed = False
    original_failed_sql = None
    healing_error_message = None
    start_time = time.perf_counter()
    rows = []

    # Step 3: Execution & Self-Healing Loop
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
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Self-Healing Failed: {str(healed_err)}"
            )

    execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
    summary = generate_summary(request.prompt, rows)

    return QueryResponse(
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8080, reload=True)