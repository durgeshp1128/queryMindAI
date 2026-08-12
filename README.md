# QueryMindAI
this project as building an **intelligent translator** that converts human questions into safe SQL code, runs it on a database, and returns the answer in a clean, visual format—along with an **Admin Dashboard** to control and train the engine.

# Example 

1 Test Basic Translation (Happy Path)
curl -X 'POST' \
  'http://127.0.0.1:8000/query' \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Show me the top 3 product categories with the most total revenue."}'

2 Test AST Guardrails (Blocked Mutation Attempt)
This test verifies that malicious, write, or structural alteration queries are caught and blocked by the sqlglot AST walker before touching SQLite, returning a 400 Bad Request.

curl -X 'POST' \
  'http://127.0.0.1:8000/query' \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Delete all canceled orders from the orders table."}'

3 Test Automatic LIMIT 100 AST Injection
This test verifies that if the LLM generates an unbounded SELECT query (or the prompt asks for all records), sqlglot automatically modifies the AST tree to inject LIMIT 100.

curl -X 'POST' \
  'http://127.0.0.1:8000/query' \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Get all active customers and their cities."}'

4 Test Successful Clean SELECT (Standard Baseline)
A standard aggregate and join query to verify that non-failing queries run cleanly with was_healed: false.

curl -X 'POST' \
  'http://127.0.0.1:8000/query' \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "What are the top 3 cities with the highest number of customers?"}'

5 Test the 1-Retry Self-Healing Loop

This query uses slightly ambiguous language ("revenue per category") where LLMs sometimes make common SQLite errors (like referencing non-existent column names or forgetting GROUP BY clauses).

If the initial execution throws a SQLAlchemyError, the loop kicks in, passes the exact SQLite error string back to the LLM, fixes the query, and executes successfully with was_healed: true.

curl -X 'POST' \
  'http://127.0.0.1:8000/query' \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "Show me total category revenue using category_name and total sales amount."}'

# How the System Identifies a Self-Healed Query

Your system tracks self-healing automatically using the was_healed boolean flag in the JSON response payload returned by your FastAPI endpoint.  

 LLM Generates SQL Query -->  Execute SQL on Database --> Executes OK --> was_healed: FALSE
                                  |
                                  ▼
                            Throws Exception
                                  |
                                  ▼
                    Send Error Back to LLM to Re-Generate
                                  |
                                  ▼
                      ExecuteFixed Query on Database
                                  |
                                  ▼
                            was_healed: TRUE
                            
# When inspect the API response:
"was_healed": false ==> First-pass success (no execution errors occurred).
"was_healed": true ==> First attempt failed, but the retry loop successfully recovered and returned valid data.