# QueryMind AI — Text-to-SQL Analytics Engine

An **intelligent translator** that converts natural language questions into safe SQL queries, executes them against a database, and returns structured results with AI summaries — powered by a **LangGraph state-machine pipeline**.

---

## 🏗️ Architecture

```
User Prompt → [LangGraph Pipeline] → Structured Response

Pipeline Nodes:
  classify → retrieve → generate_sql → validate → execute → (self_heal?) → summarize
```

| Layer | Technology |
|-------|-----------|
| **Database** | SQLite (app.db) |
| **Backend** | Python, FastAPI, Pydantic, SQLAlchemy |
| **LLM Orchestration** | LangGraph (state-machine), Groq SDK |
| **Vector Search** | ChromaDB + SentenceTransformer (all-MiniLM-L6-v2) |
| **SQL Guardrails** | sqlglot (AST parsing, validation, LIMIT injection) |
| **Frontend** | React 19, Vite, TypeScript, Vanilla CSS |

### Pipeline Flow (LangGraph)

1. **Classify** — LLM + regex categorize the query (`SELECT_SIMPLE`, `SELECT_AGGREGATE`, `SELECT_JOIN`, `SELECT_TEMPORAL`, `UNSUPPORTED`)
2. **Retrieve** — ChromaDB vector search fetches top-3 similar Q→SQL examples (few-shot)
3. **Generate SQL** — LLM generates SQL with schema context + few-shot examples
4. **Validate** — sqlglot AST parses, blocks non-SELECT, injects `LIMIT`, checks restricted tables
5. **Execute** — Runs SQL against read-only SQLite connection
6. **Self-Heal** — On failure, sends error back to LLM for 1 retry attempt
7. **Summarize** — LLM generates 1-2 sentence natural language summary

---

## 🚀 Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- A Groq API key (free at [console.groq.com](https://console.groq.com))

### Backend Setup

```bash
cd backend

# Create .env file with your API key
echo GROQ_API_KEY=your_api_key_here > .env

# Install dependencies (using uv)
uv sync

# Seed the SQLite database with synthetic e-commerce data
uv run python seed_db.py

# Seed ChromaDB with 32 few-shot Q→SQL example pairs
uv run python seed_vector_db.py

# Start the FastAPI server
uv run python main.py
# Server runs at http://127.0.0.1:8080
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the Vite dev server
npm run dev
# Frontend runs at http://localhost:5173
```

---

## 📊 Database Schema

**Domain:** E-commerce (6 tables, 1000+ rows each)

| Table | Key Columns | Relationships |
|-------|-------------|---------------|
| `customers` | customer_id, first_name, last_name, email, city, country, created_at | — |
| `categories` | category_id, category_name, description | — |
| `products` | product_id, product_name, category_id, unit_price, stock_quantity, is_active | FK → categories |
| `orders` | order_id, customer_id, order_date, status, total_amount | FK → customers |
| `order_items` | order_item_id, order_id, product_id, quantity, unit_price, subtotal | FK → orders, products |
| `payments` | payment_id, order_id, payment_method, payment_date, amount, payment_status | FK → orders |

**Design choices for testing:**
- Ambiguous column names: `total_amount` (orders) vs `unit_price` (products/order_items) vs `subtotal` (order_items)
- Multiple date columns: `order_date`, `created_at`, `payment_date`
- Status enums: order status (`completed`, `pending`, `canceled`, `shipped`), payment status (`success`, `failed`, `refunded`)

---

## 🔐 Security & Guardrails

| Layer | Protection |
|-------|-----------|
| **Regex Guardrail** | Fast-rejects prompts containing `DELETE`, `DROP`, `UPDATE`, `INSERT`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE` |
| **AST Walker** | sqlglot parses SQL and walks the AST tree to block non-SELECT operations |
| **Restricted Tables** | Admin-configurable list of tables the AI cannot query |
| **Sensitive Columns** | Columns marked as sensitive are excluded from LLM schema context |
| **LIMIT Injection** | Auto-appends `LIMIT 100` (configurable) to queries without a LIMIT clause |
| **Read-Only Connection** | Query execution uses a separate read-only SQLite connection |

---

## 🧪 Evaluation

```bash
# Run 25-query benchmark evaluation
uv run python eval_harness.py

# Run guardrails security tests (7 malicious queries)
uv run python eval_harness.py --guardrails

# Run both
uv run python eval_harness.py --all
```

**Metrics measured:**
- **Execution Accuracy (EA):** Generated SQL produces identical results to ground truth SQL
- **Exact Match (EM):** AST structural equivalence via `sqlglot.diff()`
- **Guardrails Block Rate:** 100% of malicious queries must be caught

---

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/query` | Text-to-SQL pipeline (LangGraph) |
| `GET` | `/logs` | Query execution logs |
| `GET` | `/examples` | List all few-shot examples |
| `POST` | `/examples` | Add a new Q→SQL example |
| `PUT` | `/examples/{id}` | Update an existing example |
| `DELETE` | `/examples/{id}` | Delete an example |
| `GET` | `/schema` | Database schema with metadata |
| `POST` | `/schema/metadata` | Update column description/sensitivity |
| `GET` | `/config` | Get all app config |
| `POST` | `/config` | Update app config |

---

## 🎨 Frontend Panels

| Panel | Features |
|-------|----------|
| **Chat** | Natural language input, sample prompts, sortable result tables, SQL display, AI summary, execution metadata |
| **Schema Manager** | View tables/columns, add descriptions, toggle sensitive columns |
| **Examples Manager** | Add, edit (inline), and delete Q→SQL pairs |
| **Query Logs** | Past queries with status, SQL, latency, errors |
| **Guardrails Config** | Toggle write-op blocking, set row limits, restrict tables |
| **Model Config** | Select provider (Groq/OpenAI/Anthropic/Ollama), model, temperature, max tokens, SQL dialect |

---

## ⚠️ Known Limitations

1. **Single LLM provider active:** While the UI allows selecting multiple providers, only Groq is actively wired in the backend. Switching to OpenAI/Anthropic requires adding their SDK clients.
2. **No authentication:** The app has no user auth — all endpoints are open. Not suitable for production without adding auth middleware.
3. **SQLite only:** While the SQL dialect is configurable, the execution engine is hardcoded to SQLite. PostgreSQL/MySQL support requires a different connection setup.
4. **Single-turn only:** The chat does not maintain conversation context between queries. Each question is independent.
5. **No chart rendering:** Numeric 2-column results could be auto-charted but this is not yet implemented.

---

## 📁 Project Structure

```
queryMindAI/
├── backend/
│   ├── main.py              # FastAPI app with all API endpoints
│   ├── pipeline.py           # LangGraph state-machine pipeline
│   ├── seed_db.py            # SQLite schema + synthetic data generator
│   ├── seed_vector_db.py     # ChromaDB few-shot example seeder (32 pairs)
│   ├── eval_harness.py       # 25-query benchmark + 7 guardrails tests
│   ├── app.db                # SQLite database
│   ├── chroma_db/            # ChromaDB persistent storage
│   ├── .env                  # API keys (not committed)
│   └── pyproject.toml        # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main app with tab routing
│   │   ├── App.css           # Global styles
│   │   └── component/
│   │       ├── QueryChat.tsx       # Chat interface with sortable tables
│   │       ├── SchemaManager.tsx   # Schema viewer/editor
│   │       ├── ExamplesManager.tsx # Q→SQL pair CRUD
│   │       ├── QueryLogs.tsx       # Execution log viewer
│   │       ├── GuardrailsConfig.tsx # Security settings
│   │       ├── ModelConfig.tsx     # LLM configuration
│   │       ├── Sidebar.tsx         # Navigation sidebar
│   │       └── Header.tsx          # Top header bar
│   └── package.json
└── prd.md                    # Product Requirements Document
```
## Additional points

1. Add automatic fallback to an available model if a model ID returns 404.
2. Add dynamically configure model-specific max_tokens limits in our wrapper