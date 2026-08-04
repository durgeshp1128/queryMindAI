import os
import time
from dotenv import load_dotenv
from typing import Any, Dict, List, Tuple
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
import sqlglot
import sqlglot.expressions as exp
from groq import Groq

DB_URI = "sqlite:///./app.db"
# Load the environment variables from the .env file
load_dotenv() 

app = FastAPI(
    title="QueryMind AI Production Engine",
    description="Text-to-SQL Engine with AST Guardrails & Self-Healing Loop",
    version="0.2.0"
)

engine = create_engine(DB_URI, connect_args={"check_same_thread": False})
# Initialize Groq client instead of OpenAI
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


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
    """
    Parses and verifies SQL using sqlglot AST:
    1. Ensures valid SQLite syntax.
    2. Enforces SELECT-only statement policy (rejects DROP, DELETE, UPDATE, INSERT, etc.).
    3. Automatically injects a default LIMIT clause if absent.
    
    Returns: (is_valid, sanitized_sql_str, error_message)
    """
    try:
        # Parse expression targeting SQLite dialect
        expression = sqlglot.parse_one(raw_sql, read="sqlite")
    except sqlglot.errors.ParseError as pe:
        return False, raw_sql, f"SQL Syntax Parse Error: {str(pe)}"

    if not expression:
        return False, raw_sql, "Failed to parse query structure."

    # 1. Enforce SELECT-only statement root
    if not isinstance(expression, exp.Select):
        return False, raw_sql, "Security Violation: Query must be a SELECT statement."

    # 2. Walk AST to ensure no DDL/DML mutation nodes exist
    # Note: exp.Alter is used for ALTER TABLE in sqlglot
    forbidden_list = [
        exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create
    ]
    
    # Version-safe handling for ALTER and TRUNCATE nodes
    if hasattr(exp, "Alter"):
        forbidden_list.append(exp.Alter)
    if hasattr(exp, "AlterTable"):
        forbidden_list.append(exp.AlterTable)
    if hasattr(exp, "TruncateTable"):
        forbidden_list.append(exp.TruncateTable)

    forbidden_nodes = tuple(forbidden_list)

    for node in expression.walk():
        if isinstance(node, forbidden_nodes):
            node_name = getattr(node, "key", str(type(node).__name__)).upper()
            return False, raw_sql, f"Security Violation: Non-read operation detected ({node_name})."

    # 3. Inject LIMIT clause safely if missing
    if expression.find(exp.Limit) is None:
        expression = expression.limit(default_limit)

    sanitized_sql = expression.sql(dialect="sqlite")
    return True, sanitized_sql, ""

# ==========================================
# Request / Response Schemas
# ==========================================

class QueryRequest(BaseModel):
    prompt: str = Field(..., example="What are the top 5 highest spending customers?")

class QueryResponse(BaseModel):
    sql_query: str
    original_failed_sql: str | None = None  # Populated only if healed
    healing_error_message: str | None = None  # Populated only if healed
    execution_time_ms: float
    row_count: int
    was_healed: bool
    data: List[Dict[str, Any]]
    summary: str


# ==========================================
# Text-to-SQL Core & Self-Healing Pipeline
# ==========================================

def call_llm(messages: List[Dict[str, str]]) -> str:
    """Helper call to OpenAI API returning raw message string."""
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=0.0
    )
    raw_content = response.choices[0].message.content.strip()
    return raw_content.replace("```sql", "").replace("```", "").strip()


def generate_summary(user_prompt: str, data: List[Dict[str, Any]]) -> str:
    if not data:
        return "No records were returned for this query."
    
    summary_prompt = f"""Given question: '{user_prompt}'
Result set sample: {data[:5]}

Provide a 1-2 sentence plain-language summary answering the question based on the data."""

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.3
    )
    return response.choices[0].message.content.strip()


# ==========================================
# API Endpoint
# ==========================================

@app.post("/query", response_model=QueryResponse)
def execute_text_to_sql(request: QueryRequest):
    system_instruction = f"""You are a strict SQLite text-to-SQL generator.
Output raw executable SQLite SQL ONLY. Do not wrap code in markdown.

Database Schema:
{DB_SCHEMA_CONTEXT}
"""

    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": request.prompt}
    ]

    # Generate initial SQL
    raw_sql = call_llm(messages)
    
    # Run AST Guardrail Check
    is_valid, sanitized_sql, ast_error = validate_and_sanitize_sql(raw_sql)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"AST Security/Validation Blocked Query: {ast_error}"
        )

    was_healed = False
    start_time = time.perf_counter()
    rows = []
    original_failed_sql = None
    healing_error_message = None

    # Execute with 1-Retry Self-Healing Loop
    try:
        with engine.connect() as connection:
            result = connection.execute(text(sanitized_sql))
            columns = result.keys()
            rows = [dict(zip(columns, row)) for row in result.fetchall()]

    except SQLAlchemyError as primary_err:
        # Trigger Self-Healing Attempt
        was_healed = True
        #error_details = str(primary_err)
        healing_error_message = str(primary_err)
        # Append error loop context to prompt thread
        messages.append({"role": "assistant", "content": sanitized_sql})
        messages.append({
            "role": "user", 
            "content": f"The SQL query produced this database execution error:\n'{healing_error_message}'\n"
                       f"Please fix the SQL query syntax and return ONLY the corrected SQL query."
        })

        healed_raw_sql = call_llm(messages)
        is_valid_heal, healed_sql, heal_ast_error = validate_and_sanitize_sql(healed_raw_sql)
        original_failed_sql = sanitized_sql

        if not is_valid_heal:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Self-healing generated invalid query: {heal_ast_error}"
            )

        # Retry execution with healed SQL
        try:
            with engine.connect() as connection:
                result = connection.execute(text(healed_sql))
                columns = result.keys()
                rows = [dict(zip(columns, row)) for row in result.fetchall()]
                sanitized_sql = healed_sql  # Assign healed SQL for output payload
        except SQLAlchemyError as healed_err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Self-Healing Failed. Error: {str(healed_err)}"
            )

    execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)
    summary = generate_summary(request.prompt, rows)

    return QueryResponse(
        sql_query=sanitized_sql,
        original_failed_sql = original_failed_sql,
        healing_error_message = healing_error_message,
        execution_time_ms=execution_time_ms,
        row_count=len(rows),
        was_healed=was_healed,
        data=rows,
        summary=summary
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8080, reload=True)