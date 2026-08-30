"""
QueryMind AI — LangGraph Pipeline Module

Models the Text-to-SQL pipeline as a stateful graph:
  User Prompt → Classify → Retrieve Examples → Generate SQL
    → Validate AST → Execute → (Self-Heal?) → Summarize → Return

Each step is a LangGraph node operating on a shared PipelineState.
Conditional edges handle UNSUPPORTED rejection and self-healing retry.
"""

import os
import re
import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, TypedDict, Annotated

from langgraph.graph import StateGraph, END
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
import sqlglot
import sqlglot.expressions as exp
import chromadb
from chromadb.utils import embedding_functions
from groq import Groq
from dotenv import load_dotenv

# ==========================================
# Configuration & Clients
# ==========================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()

DB_PATH = os.path.join(BASE_DIR, "app.db").replace("\\", "/")
DB_URI = f"sqlite:///{DB_PATH}"
DB_URI_READONLY = f"sqlite:///file:{DB_PATH}?mode=ro&uri=true"
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")

engine = create_engine(DB_URI, connect_args={"check_same_thread": False})

# Read-only engine for query execution (Phase 2.11 PRD requirement)
try:
    ro_engine = create_engine(
        DB_URI_READONLY,
        connect_args={"check_same_thread": False}
    )
except Exception:
    # Fallback to read-write if read-only mode is not supported
    ro_engine = engine

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"), timeout=15.0)

# ChromaDB
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)
collection = chroma_client.get_or_create_collection(
    name="sql_examples",
    embedding_function=sentence_transformer_ef,
)


# ==========================================
# Enums
# ==========================================

class QueryCategory(str, Enum):
    SELECT_SIMPLE = "SELECT_SIMPLE"
    SELECT_AGGREGATE = "SELECT_AGGREGATE"
    SELECT_JOIN = "SELECT_JOIN"
    SELECT_TEMPORAL = "SELECT_TEMPORAL"
    UNSUPPORTED = "UNSUPPORTED"


# ==========================================
# Pipeline State (shared across all nodes)
# ==========================================

class PipelineState(TypedDict):
    # --- Inputs ---
    prompt: str

    # --- Classification ---
    category: str
    classification_reason: str

    # --- Retrieval ---
    retrieved_examples: List[Dict[str, str]]

    # --- SQL Generation & Validation ---
    raw_sql: str
    sanitized_sql: str
    is_valid: bool
    ast_error: str

    # --- Execution ---
    data: List[Dict[str, Any]]
    row_count: int
    execution_time_ms: float

    # --- Self-Healing ---
    heal_attempts: int
    was_healed: bool
    original_failed_sql: Optional[str]
    healing_error_message: Optional[str]

    # --- Summary ---
    summary: str

    # --- Error Handling ---
    error: Optional[str]
    status: str  # "SUCCESS", "ERROR", "REJECTED", "EXECUTION_ERROR"


# ==========================================
# Helper: Clean Raw LLM SQL Output
# ==========================================

def extract_clean_sql(raw_text: str) -> str:
    """Extracts raw SQL from LLM response, stripping reasoning tags, markdown and explanatory preambles."""
    if not raw_text:
        return ""
    
    # Remove reasoning blocks (e.g., <think>...</think>)
    text_clean = re.sub(r"<think>[\s\S]*?</think>", "", raw_text, flags=re.IGNORECASE).strip()

    # Extract SQL from markdown codeblocks if present
    code_block_match = re.search(r"```(?:sql|SQL)?\s*([\s\S]*?)\s*```", text_clean)
    if code_block_match:
        text_clean = code_block_match.group(1).strip()

    # If the LLM output contains conversational intro/outro, extract starting from SELECT
    select_match = re.search(r"\b(SELECT\b[\s\S]*?)(?:;|\Z)", text_clean, re.IGNORECASE)
    if select_match:
        sql = select_match.group(1).strip()
    else:
        sql = text_clean.strip()

    if not sql:
        return ""

    # Remove trailing semicolons and whitespace for sqlglot uniformity
    return sql.rstrip("; \t\n\r") + ";"


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


def get_safe_model_name() -> str:
    """
    Returns a valid text generation model name.
    Filters out classification-only models (like prompt-guard) that cannot handle chat templates.
    """
    model = get_config("model_name", "openai/gpt-oss-120b")
    if not model or any(bad in model.lower() for bad in ["guard", "prompt"]):
        return "openai/gpt-oss-120b"
    return model


FALLBACK_MODEL_CHAIN = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "groq/compound",
    "groq/compound-mini",
    "qwen/qwen3.6-27b",
]

# Model-specific max output token limits
MODEL_MAX_TOKENS_MAP: Dict[str, int] = {
    # High-capacity chat/code models (up to 4096 output tokens)
    "openai/gpt-oss-120b": 4096,
    "qwen/qwen3.8-27b": 4096,
    "qwen/qwen3.6-27b": 4096,
    
    # Standard models (up to 2048 output tokens)
    "openai/gpt-oss-20b": 2048,
    "groq/compound": 2048,
    "groq/compound-mini": 1024,
    
    # Classification / Small models (up to 512 tokens)
    "meta-llama/llama-prompt-guard-2-22m": 512,
    "meta-llama/llama-prompt-guard-2-86m": 512,
    
    # Fallback default for any unlisted model
    "DEFAULT": 1024,
}


def clamp_max_tokens(model: str, requested_tokens: Optional[int]) -> int:
    """
    Validates and clamps requested max_tokens to safe boundaries:
      - Minimum: 1 token
      - Maximum: MODEL_MAX_TOKENS_MAP[model] (or DEFAULT if unlisted)
      - Invalid/None: Default to 512
    """
    if requested_tokens is None or not isinstance(requested_tokens, int) or requested_tokens <= 0:
        return 512

    ceiling = MODEL_MAX_TOKENS_MAP.get(model, MODEL_MAX_TOKENS_MAP["DEFAULT"])
    clamped = max(1, min(requested_tokens, ceiling))

    if clamped != requested_tokens:
        print(f"[Token Clamping] ℹ️ Model '{model}' ceiling is {ceiling}. Clamped requested {requested_tokens} → {clamped}.")

    return clamped


def call_llm_with_fallback(
    messages: List[Dict[str, str]],
    temperature: float = 0.0,
    max_tokens: int = 512,
    preferred_model: Optional[str] = None,
) -> str:
    """
    Executes a Groq chat completion call with automatic multi-model fallback.
    Automatically validates and clamps max_tokens for each model in the fallback chain.
    If the preferred model returns 404 (NotFoundError), is deprecated, or fails,
    it automatically falls back down the FALLBACK_MODEL_CHAIN until successful.
    """
    if preferred_model is None:
        preferred_model = get_safe_model_name()

    # Build priority list: preferred model first, then fallback chain without duplicates
    models_to_try = [preferred_model] + [m for m in FALLBACK_MODEL_CHAIN if m != preferred_model]

    last_error = None
    for model in models_to_try:
        # Dynamically validate and clamp tokens for the current model
        safe_max_tokens = clamp_max_tokens(model, max_tokens)

        try:
            response = groq_client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=safe_max_tokens,
                timeout=15.0,
            )
            content = response.choices[0].message.content or ""
            return content.strip()
        except Exception as err:
            err_str = str(err).lower()
            # Check for 404, not_found, model deprecation, or invalid request errors
            is_fallbackable = any(kw in err_str for kw in [
                "404", "not_found", "does not exist", "model_not_found", 
                "deprecated", "decommissioned", "invalid_request_error", "not found"
            ])
            
            print(f"⚠️ Warning: Groq call with model '{model}' failed ({err}).")
            if is_fallbackable or model != models_to_try[-1]:
                print(f"🔄 Automatically falling back to next available model...")
                last_error = err
                continue
            else:
                last_error = err
                continue

    raise RuntimeError(f"All LLM models in fallback chain failed. Last error: {last_error}")


# ==========================================
# Schema Context Helper
# ==========================================

def get_database_schema_context() -> str:
    inspector = inspect(engine)
    schema_lines = []
    internal_tables = {"query_logs", "schema_metadata", "app_config"}

    # Load existing metadata into a lookup dict
    meta_lookup = {}
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("SELECT table_name, column_name, description, is_sensitive FROM schema_metadata")
            )
            for r in rows:
                meta_lookup[(r[0], r[1])] = {
                    "description": r[2] or "",
                    "is_sensitive": bool(r[3]),
                }
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
# Regex Security Guardrail
# ==========================================

FORBIDDEN_KEYWORDS_REGEX = re.compile(
    r"\b(delete|drop|update|insert|alter|truncate|create|grant|revoke)\b",
    re.IGNORECASE,
)


# ==========================================
# Node Functions
# ==========================================

def classify_node(state: PipelineState) -> dict:
    """
    Node 1: Classify the user's prompt into a QueryCategory.
    Fast-rejects destructive operations before calling LLMs.
    """
    prompt = state["prompt"]

    # 1. Immediate Rule-Based Security Guardrail
    if FORBIDDEN_KEYWORDS_REGEX.search(prompt):
        return {
            "category": QueryCategory.UNSUPPORTED.value,
            "classification_reason": "Query contains prohibited data modification commands (DELETE, DROP, UPDATE, etc.).",
            "status": "REJECTED",
            "error": "Query contains prohibited data modification commands (DELETE, DROP, UPDATE, etc.).",
        }

    # 2. LLM-Based Categorization
    classification_prompt = (
        'You are an expert SQL Query Classifier. Analyze the user\'s natural language request '
        'and assign it to EXACTLY ONE of the following categories:\n'
        'SELECT_SIMPLE: Basic retrieval of records (e.g., "List all active products", "Show customers from NY").\n'
        'SELECT_AGGREGATE: Involves math, summaries, totals, averages, or groupings (e.g., "Count total orders", "Average sales per category").\n'
        'SELECT_JOIN: Involves combining 2+ tables (e.g., "List products with their category names", "Show orders with customer info").\n'
        'SELECT_TEMPORAL: Involves date/time filtering or trends (e.g., "Orders placed in 2024", "Monthly sales").\n'
        'UNSUPPORTED: Anything that asks to modify database records or is completely out of scope.\n\n'
        'Respond with ONLY the exact category name (e.g., SELECT_AGGREGATE). Do not output punctuation or extra text.\n\n'
        f'User Request: "{prompt}"\nCategory:'
    )

    try:
        raw_category = call_llm_with_fallback(
            messages=[{"role": "user", "content": classification_prompt}],
            temperature=0.0,
            max_tokens=100
        ).upper()

        for cat in QueryCategory:
            if cat.value in raw_category:
                return {
                    "category": cat.value,
                    "classification_reason": f"Classified as {cat.value}",
                }

        return {
            "category": QueryCategory.SELECT_SIMPLE.value,
            "classification_reason": "Defaulted to SELECT_SIMPLE",
        }

    except Exception as e:
        return {
            "category": QueryCategory.SELECT_SIMPLE.value,
            "classification_reason": f"Classification API error fallback: {str(e)}",
        }


def retrieve_node(state: PipelineState) -> dict:
    """
    Node 2: Retrieve few-shot examples from ChromaDB.
    """
    prompt = state["prompt"]
    top_k = 3

    results = collection.query(query_texts=[prompt], n_results=top_k)

    examples = []
    if results and results.get("documents") and results["documents"][0]:
        questions = results["documents"][0]
        metadatas = results["metadatas"][0]

        for q, meta in zip(questions, metadatas):
            examples.append({"question": q, "sql": meta["sql"]})

    return {"retrieved_examples": examples}


def generate_sql_node(state: PipelineState) -> dict:
    """
    Node 3: Generate SQL using LLM with schema context + few-shot examples.
    """
    prompt = state["prompt"]
    category = state.get("category", "SELECT_SIMPLE")
    retrieved_examples = state.get("retrieved_examples", [])

    examples_str = ""
    if retrieved_examples:
        examples_str = "\nHere are relevant example questions and their target SQL queries:\n\n"
        for i, ex in enumerate(retrieved_examples, 1):
            examples_str += f"Example {i}:\nQuestion: {ex['question']}\nSQL: {ex['sql']}\n\n"

    dynamic_schema = get_database_schema_context()

    system_instruction = (
        "You are an expert SQLite Text-to-SQL engine. Return ONLY executable SQL. "
        "No markdown, no ```sql, no explanations.\n\n"
        f"SCHEMA:\n{dynamic_schema}\n"
        f"{examples_str}\n"
        f"RULES:\n"
        f"QUERY TYPE: The user query is classified as {category}.\n"
        "DIALECT: SQLite only. Use strftime('%Y', c) for years, strftime('%Y-%m', c) for months. "
        "No DATE_TRUNC, EXTRACT, or ILIKE. Use LIKE.\n"
        "COLUMNS: Never use 'SELECT *'. Explicitly list required columns.\n"
        "AGGREGATIONS: Pair SUM/COUNT/AVG with GROUP BY. Filter aggregates using HAVING.\n"
        "JOINS: Use LEFT JOIN + 'WHERE fk IS NULL' for missing/unmatched records.\n"
        "ALIASES: Use explicit descriptive aliases (e.g., total_orders, total_spent, avg_price).\n"
    )

    temperature = float(get_config("temperature", "0.0"))
    max_tokens = int(get_config("max_tokens", "512"))

    raw_response = call_llm_with_fallback(
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )

    raw_sql = extract_clean_sql(raw_response)
    print(f"\n[1. SQL Generation] 📝 Prompt: \"{prompt}\"")
    print(f"[1. SQL Generation] ⚙️  Generated Initial SQL: {raw_sql}")
    return {"raw_sql": raw_sql}


def validate_node(state: PipelineState) -> dict:
    """
    Node 4: Validate and sanitize SQL using sqlglot AST.
    Checks for forbidden operations, restricted tables, and injects LIMIT.
    """
    raw_sql = state.get("raw_sql", "")
    if not raw_sql:
        print("[2. AST Validation] ❌ Error: No SQL was generated.")
        return {
            "is_valid": False,
            "sanitized_sql": "",
            "ast_error": "No SQL was generated.",
            "status": "AST_ERROR"
        }

    default_limit = int(get_config("default_row_limit", "100"))
    sql_dialect = get_config("sql_dialect", "sqlite")

    try:
        expression = sqlglot.parse_one(raw_sql, read=sql_dialect)
    except sqlglot.errors.ParseError as pe:
        print(f"[2. AST Validation] ❌ Parse Error: {pe}")
        return {
            "is_valid": False,
            "sanitized_sql": raw_sql,
            "ast_error": f"SQL Syntax Parse Error: {str(pe)}",
            "status": "AST_ERROR",
            "error": f"SQL Syntax Parse Error: {str(pe)}"
        }

    if not expression or not isinstance(expression, exp.Select):
        print("[2. AST Validation] ❌ Security Violation: Query must be a SELECT statement.")
        return {
            "is_valid": False,
            "sanitized_sql": raw_sql,
            "ast_error": "Security Violation: Query must be a SELECT statement.",
            "status": "SECURITY_VIOLATION",
            "error": "Security Violation: Query must be a SELECT statement."
        }

    # Reject empty SELECT statements (e.g. just 'SELECT;' with no expressions/FROM)
    if not expression.expressions and expression.args.get("from") is None:
        print("[2. AST Validation] ❌ Incomplete SELECT statement.")
        return {
            "is_valid": False,
            "sanitized_sql": raw_sql,
            "ast_error": "SQL Syntax Parse Error: Incomplete SELECT statement (no columns or tables specified).",
            "status": "AST_ERROR",
            "error": "SQL Syntax Parse Error: Incomplete SELECT statement."
        }

    forbidden_list = [exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create]
    if hasattr(exp, "Alter"):
        forbidden_list.append(exp.Alter)
    if hasattr(exp, "AlterTable"):
        forbidden_list.append(exp.AlterTable)
    if hasattr(exp, "TruncateTable"):
        forbidden_list.append(exp.TruncateTable)

    # Check restricted tables
    restricted_raw = get_config("restricted_tables", "")
    restricted_set = {t.strip().lower() for t in restricted_raw.split(",") if t.strip()}
    if restricted_set:
        for table_node in expression.find_all(exp.Table):
            if table_node.name.lower() in restricted_set:
                print(f"[2. AST Validation] ❌ Access to restricted table: '{table_node.name}'")
                return {
                    "is_valid": False,
                    "sanitized_sql": raw_sql,
                    "ast_error": f"Security Violation: Access to table '{table_node.name}' is restricted.",
                    "status": "SECURITY_VIOLATION",
                    "error": f"Security Violation: Access to table '{table_node.name}' is restricted."
                }

    for node in expression.walk():
        if isinstance(node, tuple(forbidden_list)):
            node_name = getattr(node, "key", str(type(node).__name__)).upper()
            print(f"[2. AST Validation] ❌ Prohibited operation detected: {node_name}")
            return {
                "is_valid": False,
                "sanitized_sql": raw_sql,
                "ast_error": f"Security Violation: Non-read operation detected ({node_name}).",
                "status": "SECURITY_VIOLATION",
                "error": f"Security Violation: Non-read operation detected ({node_name})."
            }

    if expression.find(exp.Limit) is None:
        expression = expression.limit(default_limit)

    sanitized_sql = expression.sql(dialect=sql_dialect)
    print(f"[2. AST Validation] ✅ Passed. Validated SQL: {sanitized_sql}")
    return {
        "is_valid": True,
        "sanitized_sql": sanitized_sql,
        "ast_error": "",
    }


def execute_node(state: PipelineState) -> dict:
    """
    Node 5: Execute validated SQL against the database.
    Uses read-only connection for safety.
    """
    sanitized_sql = state.get("sanitized_sql", "")
    if not sanitized_sql:
        print("[3. Execution] ❌ No SQL to execute.")
        return {
            "data": [],
            "row_count": 0,
            "execution_time_ms": 0.0,
            "error": "No SQL to execute.",
            "status": "ERROR",
        }

    print(f"[3. Execution] 🚀 Executing query on SQLite: {sanitized_sql}")
    start_time = time.perf_counter()

    try:
        with ro_engine.connect() as connection:
            result = connection.execute(text(sanitized_sql))
            columns = result.keys()
            rows = [dict(zip(columns, row)) for row in result.fetchall()]

        execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
        print(f"[3. Execution] ✅ Succeeded! Returned {len(rows)} rows in {execution_time_ms}ms")

        return {
            "data": rows,
            "row_count": len(rows),
            "execution_time_ms": execution_time_ms,
            "error": None,
            "status": "SUCCESS",
        }

    except SQLAlchemyError as e:
        execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
        print(f"[3. Execution] 💥 Execution FAILED with SQLAlchemyError:")
        print(f"    Error: {e}")
        
        # Only record initial failed SQL and message if not already set
        orig_sql = state.get("original_failed_sql") or sanitized_sql
        orig_err = state.get("healing_error_message") or str(e)
        
        return {
            "data": [],
            "row_count": 0,
            "execution_time_ms": execution_time_ms,
            "error": str(e),
            "status": "EXECUTION_ERROR",
            "original_failed_sql": orig_sql,
            "healing_error_message": orig_err,
        }


def self_heal_node(state: PipelineState) -> dict:
    """
    Node 6: Self-healing — send the error back to the LLM to fix the SQL.
    Only invoked when execution fails or AST has syntax error, and heal_attempts < 1.
    """
    attempt_num = state.get("heal_attempts", 0) + 1
    prompt = state["prompt"]
    failed_sql = state.get("sanitized_sql") or state.get("raw_sql", "")
    error_msg = state.get("error") or state.get("ast_error", "Unknown execution error")

    print("\n" + "=" * 65)
    print(f"⚡ [Self-Healing Activated] Attempt {attempt_num}/1")
    print(f"⚡ [Self-Healing] User Prompt   : {prompt}")
    print(f"⚡ [Self-Healing] Failed SQL    : {failed_sql}")
    print(f"⚡ [Self-Healing] Captured Error: {error_msg}")
    print(f"⚡ [Self-Healing] 🤖 Sending error back to LLM for diagnosis & recorrection...")
    print("=" * 65)

    temperature = float(get_config("temperature", "0.0"))
    max_tokens = int(get_config("max_tokens", "512"))

    dynamic_schema = get_database_schema_context()

    system_instruction = (
        "You are an expert SQLite Text-to-SQL engine diagnosing and fixing a failed SQL query.\n"
        "Return ONLY the corrected, executable SQLite SQL query. No markdown, no ```sql, no conversational text.\n\n"
        f"DATABASE SCHEMA:\n{dynamic_schema}\n\n"
        "RULES:\n"
        "1. Fix the exact column names, table joins, or syntax errors mentioned in the error.\n"
        "2. Ensure SQLite dialect compatibility.\n"
        "3. Output ONLY the raw SQL query."
    )

    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": prompt},
        {"role": "assistant", "content": failed_sql},
        {
            "role": "user",
            "content": f"The query failed with error: '{error_msg}'. Fix the SQL and output ONLY the corrected SQL query.",
        },
    ]

    raw_response = call_llm_with_fallback(
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    healed_sql = extract_clean_sql(raw_response)
    print(f"⚡ [Self-Healing] 📥 LLM Returned Corrected SQL: {healed_sql}")

    return {
        "raw_sql": healed_sql,
        "heal_attempts": attempt_num,
        "was_healed": True,
        "original_failed_sql": state.get("original_failed_sql") or failed_sql,
        "healing_error_message": state.get("healing_error_message") or error_msg,
    }


def summarize_node(state: PipelineState) -> dict:
    """
    Node 7: Generate a natural language summary of the query results.
    """
    prompt = state["prompt"]
    data = state.get("data", [])

    if not data:
        return {"summary": "No records were returned for this query."}

    summary_prompt = (
        f"Question: '{prompt}'\n"
        f"Sample Data: {data[:5]}\n"
        "Provide a concise 1-2 sentence summary."
    )

    summary = call_llm_with_fallback(
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.3,
        max_tokens=256,
    )

    return {"summary": summary}


# ==========================================
# Routing Functions (Conditional Edges)
# ==========================================

def route_after_classify(state: PipelineState) -> str:
    """Route after classification — reject if UNSUPPORTED."""
    if state.get("category") == QueryCategory.UNSUPPORTED.value:
        print("[Router] 🚫 Query classified as UNSUPPORTED. Rejecting.")
        return "rejected"
    return "retrieve"


def route_after_validate(state: PipelineState) -> str:
    """
    Route after validation:
      - If valid ➔ execute
      - If security violation ➔ reject immediately
      - If syntax error and heal_attempts < 1 ➔ self_heal
      - Otherwise ➔ heal_failed or rejected
    """
    if state.get("is_valid", False):
        return "execute"
    
    if state.get("status") == "SECURITY_VIOLATION":
        print("[Router] 🚫 Security violation. Rejecting query.")
        return "rejected"
    
    # If syntax error and we haven't attempted healing yet, give self_heal a chance!
    if state.get("heal_attempts", 0) < 1:
        print("[Router] 🔄 Validation syntax error detected. Routing to Self-Healing...")
        return "self_heal"
    
    return "heal_failed"


def route_after_execute(state: PipelineState) -> str:
    """Route after execution — heal if failed and attempts remain, otherwise proceed."""
    if state.get("status") == "EXECUTION_ERROR":
        if state.get("heal_attempts", 0) < 1:
            print("[Router] 🔄 Execution error detected. Routing to Self-Healing Node...")
            return "self_heal"
        print("[Router] ❌ Self-Healing retry limit reached. Marking as failed.")
        return "heal_failed"
    
    if state.get("was_healed"):
        print("[Self-Healing] 🏆 Self-Healing Succeeded! Repaired query executed successfully.")
    return "summarize"


def set_rejected(state: PipelineState) -> dict:
    """Terminal node for rejected queries."""
    return {"status": "REJECTED"}


def set_heal_failed(state: PipelineState) -> dict:
    """Terminal node when self-healing also fails."""
    return {"status": "ERROR"}


# ==========================================
# Build the LangGraph
# ==========================================

def build_pipeline_graph() -> StateGraph:
    """
    Constructs the Text-to-SQL pipeline as a LangGraph StateGraph.

    Graph topology:
        classify → (UNSUPPORTED?) → retrieve → generate_sql → validate
          → (invalid?) → self_heal → validate
          → (valid) → execute → (error + attempts < 1?) → self_heal → validate
          → (success) → summarize → END
    """
    graph = StateGraph(PipelineState)

    # Add nodes
    graph.add_node("classify", classify_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("generate_sql", generate_sql_node)
    graph.add_node("validate", validate_node)
    graph.add_node("execute", execute_node)
    graph.add_node("self_heal", self_heal_node)
    graph.add_node("summarize", summarize_node)
    graph.add_node("rejected", set_rejected)
    graph.add_node("heal_failed", set_heal_failed)

    # Set entry point
    graph.set_entry_point("classify")

    # 1. After classify
    graph.add_conditional_edges(
        "classify",
        route_after_classify,
        {"rejected": "rejected", "retrieve": "retrieve"},
    )

    # 2. Linear edges
    graph.add_edge("retrieve", "generate_sql")
    graph.add_edge("generate_sql", "validate")

    # 3. After validation
    graph.add_conditional_edges(
        "validate",
        route_after_validate,
        {
            "rejected": "rejected",
            "execute": "execute",
            "self_heal": "self_heal",
            "heal_failed": "heal_failed",
        },
    )

    # 4. After execution
    graph.add_conditional_edges(
        "execute",
        route_after_execute,
        {
            "self_heal": "self_heal",
            "heal_failed": "heal_failed",
            "summarize": "summarize",
        },
    )

    # 5. Self-heal loops back to validate
    graph.add_edge("self_heal", "validate")

    # 6. Terminal edges
    graph.add_edge("summarize", END)
    graph.add_edge("rejected", END)
    graph.add_edge("heal_failed", END)

    return graph


# Compile the graph once at module level
pipeline_graph = build_pipeline_graph()
compiled_pipeline = pipeline_graph.compile()


def run_pipeline(prompt: str) -> PipelineState:
    """
    Execute the full Text-to-SQL pipeline for a given user prompt.
    Returns the final PipelineState with all results.
    """
    initial_state: PipelineState = {
        "prompt": prompt,
        "category": "",
        "classification_reason": "",
        "retrieved_examples": [],
        "raw_sql": "",
        "sanitized_sql": "",
        "is_valid": False,
        "ast_error": "",
        "data": [],
        "row_count": 0,
        "execution_time_ms": 0.0,
        "heal_attempts": 0,
        "was_healed": False,
        "original_failed_sql": None,
        "healing_error_message": None,
        "summary": "",
        "error": None,
        "status": "",
    }

    result = compiled_pipeline.invoke(initial_state)
    return result
