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

# Import the LangGraph pipeline
from pipeline import (
    run_pipeline,
    engine,
    collection,
    get_config,
    QueryCategory,
    get_database_schema_context,
)

DB_URI = "sqlite:///./app.db"
CHROMA_DIR = "./chroma_db"

# Load environment variables
load_dotenv()

app = FastAPI(
    title="QueryMind AI Production Engine",
    description="Text-to-SQL Engine with LangGraph Pipeline, ChromaDB Few-Shot RAG, AST Guardrails & Self-Healing",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
            "model_name": "openai/gpt-oss-20b",
            "temperature": "0.0",
            "max_tokens": "512",
            "sql_dialect": "sqlite",
        }
        for key, value in defaults.items():
            connection.execute(text(
                "INSERT OR IGNORE INTO app_config (key, value) VALUES (:key, :value)"
            ), {"key": key, "value": value})

        # Normalize max_tokens to 512 to avoid Groq 400 errors with models capped at 512
        connection.execute(text(
            "UPDATE app_config SET value = '512' WHERE key = 'max_tokens' AND CAST(value AS INTEGER) > 512"
        ))
        
        # Automatically reset model_name if it was set to a non-chat classification model
        connection.execute(text(
            "UPDATE app_config SET value = 'openai/gpt-oss-20b' WHERE key = 'model_name' AND (value LIKE '%guard%' OR value = '')"
        ))
        connection.commit()


# ==========================================
# Pydantic Schemas
# ==========================================

class QueryRequest(BaseModel):
    prompt: str = Field(..., example="Show top 3 buyers in New York by total spending")

class QueryResponse(BaseModel):
    query_category: str
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
# Query Logging Helper
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


# ==========================================
# Main Query Endpoint — LangGraph Pipeline
# ==========================================

@app.post("/query", response_model=QueryResponse)
def execute_text_to_sql(request: QueryRequest):
    """
    Execute the full Text-to-SQL pipeline via LangGraph.
    
    The pipeline graph handles:
      1. Query Classification & fast rejection
      2. Few-Shot RAG Retrieval from ChromaDB
      3. SQL Generation via LLM
      4. AST Validation & Guardrails
      5. SQL Execution with read-only connection
      6. Self-Healing retry (1 attempt)
      7. Natural language summary generation
    """
    # Run the LangGraph pipeline
    result = run_pipeline(request.prompt)

    # Handle rejected queries
    if result.get("status") == "REJECTED":
        error_msg = result.get("error") or result.get("ast_error") or "Query rejected"
        log_query(
            request.prompt,
            sql_query=result.get("sanitized_sql"),
            status="ERROR",
            error_message=error_msg,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query Rejected: {error_msg}",
        )

    # Handle execution errors (self-healing also failed)
    if result.get("status") == "ERROR":
        error_msg = result.get("error") or result.get("healing_error_message") or "Pipeline error"
        log_query(
            request.prompt,
            sql_query=result.get("sanitized_sql"),
            status="ERROR",
            latency_ms=result.get("execution_time_ms"),
            error_message=error_msg,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Self-Healing Failed: {error_msg}",
        )

    # Success — log and return
    log_query(
        request.prompt,
        sql_query=result.get("sanitized_sql"),
        status="SUCCESS",
        latency_ms=result.get("execution_time_ms"),
        error_message=result.get("healing_error_message") if result.get("was_healed") else None,
    )

    return QueryResponse(
        query_category=result.get("category", "SELECT_SIMPLE"),
        sql_query=result.get("sanitized_sql", ""),
        retrieved_examples=result.get("retrieved_examples", []),
        original_failed_sql=result.get("original_failed_sql"),
        healing_error_message=result.get("healing_error_message"),
        execution_time_ms=result.get("execution_time_ms", 0.0),
        row_count=result.get("row_count", 0),
        was_healed=result.get("was_healed", False),
        data=result.get("data", []),
        summary=result.get("summary", ""),
    )


# ==========================================
# Admin API Endpoints (unchanged)
# ==========================================

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

@app.put("/examples/{example_id}", response_model=ExampleResponse)
def update_example(example_id: str, request: ExampleRequest):
    """Update an existing question-to-SQL example pair in the vector DB."""
    collection.update(
        ids=[example_id],
        documents=[request.question],
        metadatas=[{"sql": request.sql}],
    )
    return ExampleResponse(id=example_id, question=request.question, sql=request.sql)

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