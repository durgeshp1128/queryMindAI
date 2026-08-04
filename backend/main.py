import os
import time
from dotenv import load_dotenv
from typing import Any, Dict, List
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
#from openai import OpenAI
from groq import Groq

DB_URI = "sqlite:///./app.db"

# Load the environment variables from the .env file
load_dotenv() 

# Initialize FastAPI app
app = FastAPI(
    title="QueryMind AI Core Engine",
    description="Minimal Text-to-SQL Pipeline API",
    version="0.1.0"
)

# SQLite engine setup
engine = create_engine(DB_URI, connect_args={"check_same_thread": False})

# Initialize LLM Client
#client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
# Initialize Groq client instead of OpenAI
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


# ==========================================
# Schema Extraction Helpers
# ==========================================

def get_database_schema_context() -> str:
    """Dynamically inspects the SQLite database to build an LLM-friendly schema prompt."""
    inspector = inspect(engine)
    schema_lines = []

    for table_name in inspector.get_table_names():
        schema_lines.append(f"Table: {table_name}")
        
        # Extract columns
        columns = inspector.get_columns(table_name)
        col_desc = []
        for col in columns:
            col_desc.append(f"{col['name']} ({col['type']})")
        schema_lines.append(f"  Columns: {', '.join(col_desc)}")
        
        # Extract foreign key relationships
        fks = inspector.get_foreign_keys(table_name)
        for fk in fks:
            schema_lines.append(
                f"  FK: {table_name}.{fk['constrained_columns'][0]} -> {fk['referred_table']}.{fk['referred_columns'][0]}"
            )
        schema_lines.append("")

    return "\n".join(schema_lines)


# Cache schema string context in memory to avoid constant DB inspection
DB_SCHEMA_CONTEXT = get_database_schema_context()


# ==========================================
# Request / Response Schemas
# ==========================================

class QueryRequest(BaseModel):
    prompt: str = Field(..., example="What are the top 5 highest spending customers?")

class QueryResponse(BaseModel):
    sql_query: str
    execution_time_ms: float
    row_count: int
    data: List[Dict[str, Any]]
    summary: str


# ==========================================
# Text-to-SQL Pipeline Service
# ==========================================

def generate_sql(user_prompt: str) -> str:
    """Constructs prompt context and invokes Groq to output raw SELECT SQL."""
    system_prompt = f"""You are a strict Text-to-SQL generator for a SQLite database.
    Return ONLY valid SQL enclosed in standard text. Do NOT use markdown code blocks (e.g. ```sql). 

    Database Dialect: SQLite
    Database Schema:
    {DB_SCHEMA_CONTEXT}

    Rules:
    1. Generate SELECT statements ONLY.
    2. If ambiguous, assume standard SQL aggregations.
    3. Keep queries performant. Always add 'LIMIT 100' if no explicit limit is specified in the prompt.
    4. Do NOT output explanations, introductory text, or Markdown formatting.
    """

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.0
    )
    
    # Strip whitespace and any residual markdown code block wrappers
    raw_sql = response.choices[0].message.content.strip()
    clean_sql = raw_sql.replace("```sql", "").replace("```", "").strip()
    return clean_sql


def generate_summary(user_prompt: str, data: List[Dict[str, Any]]) -> str:
    """Generates a 1-2 sentence plain language summary of the returned dataset."""
    if not data:
        return "No matching records were found in the database."
    
    # Send up to the first 5 records to keep token overhead low
    sample_data = data[:5]
    
    summary_prompt = f"""Given the user question: '{user_prompt}' And this sample result set: {sample_data} 
    Provide a concise 1 to 2 sentence natural language summary explaining the result."""

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": summary_prompt}],
        temperature=0.3
    )
    return response.choices[0].message.content.strip()


# ==========================================
# API Route Endpoint
# ==========================================

@app.post("/query", response_model=QueryResponse)
def text_to_sql_endpoint(request: QueryRequest):
    # Step 1: LLM Translation
    try:
        sql_query = generate_sql(request.prompt)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate SQL query: {str(e)}"
        )

    # Simple pre-execution safety guardrail check
    forbidden_keywords = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE"]
    if any(keyword in sql_query.upper() for keyword in forbidden_keywords):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security Violation: Generated SQL contains non-SELECT write/alter operations."
        )

    # Step 2: Database Execution (with execution time benchmarking)
    start_time = time.perf_counter()
    
    try:
        with engine.connect() as connection:
            result = connection.execute(text(sql_query))
            # Convert Query Result Rows to List of Dictionaries
            columns = result.keys()
            rows = [dict(zip(columns, row)) for row in result.fetchall()]
            
    except SQLAlchemyError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"SQL Execution Error: {str(err)}"
        )
        
    execution_time_ms = round((time.perf_counter() - start_time) * 1000, 2)

    # Step 3: Natural Language Summary Generation
    summary = generate_summary(request.prompt, rows)

    return QueryResponse(
        sql_query=sql_query,
        execution_time_ms=execution_time_ms,
        row_count=len(rows),
        data=rows,
        summary=summary
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8080, reload=True)