import chromadb
from chromadb.utils import embedding_functions
import os
from dotenv import load_dotenv


DB_DIR = "./chroma_db"
# Load the environment variables from the .env file
load_dotenv() 

def init_vector_db():
    # Initialize persistent ChromaDB client
    client = chromadb.PersistentClient(path=DB_DIR)
    
    # Use standard default sentence transformer embedding or OpenAI embeddings
    sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")

    collection = client.get_or_create_collection(
        name="sql_examples",
        embedding_function=sentence_transformer_ef
    )

    # 10 High-Quality E-Commerce Example Pairs
    examples = [
        {
            "id": "ex_1",
            "question": "What are the top 5 highest spending customers?",
            "sql": "SELECT c.customer_id, c.first_name, c.last_name, SUM(o.total_amount) AS total_spent FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.status = 'completed' GROUP BY c.customer_id ORDER BY total_spent DESC LIMIT 5;"
        },
        {
            "id": "ex_2",
            "question": "Which product categories generated the most total revenue?",
            "sql": "SELECT cat.category_name, SUM(oi.subtotal) AS category_revenue FROM categories cat JOIN products p ON cat.category_id = p.category_id JOIN order_items oi ON p.product_id = oi.product_id JOIN orders o ON oi.order_id = o.order_id WHERE o.status != 'canceled' GROUP BY cat.category_name ORDER BY category_revenue DESC;"
        },
        {
            "id": "ex_3",
            "question": "List all customers who have not placed any orders.",
            "sql": "SELECT c.customer_id, c.first_name, c.last_name, c.email FROM customers c LEFT JOIN orders o ON c.customer_id = o.customer_id WHERE o.order_id IS NULL;"
        },
        {
            "id": "ex_4",
            "question": "What is the average order value (AOV) per payment method?",
            "sql": "SELECT p.payment_method, AVG(p.amount) AS avg_payment_amount FROM payments p WHERE p.payment_status = 'success' GROUP BY p.payment_method ORDER BY avg_payment_amount DESC;"
        },
        {
            "id": "ex_5",
            "question": "How many orders were placed each month in 2024?",
            "sql": "SELECT strftime('%Y-%m', order_date) AS month, COUNT(order_id) AS total_orders FROM orders WHERE strftime('%Y', order_date) = '2024' GROUP BY month ORDER BY month ASC;"
        },
        {
            "id": "ex_6",
            "question": "Which products are low in stock (less than 20 items remaining)?",
            "sql": "SELECT product_id, product_name, stock_quantity FROM products WHERE stock_quantity < 20 AND is_active = 1 ORDER BY stock_quantity ASC;"
        },
        {
            "id": "ex_7",
            "question": "Find the total revenue generated from PayPal payments.",
            "sql": "SELECT SUM(amount) AS total_paypal_revenue FROM payments WHERE payment_method = 'paypal' AND payment_status = 'success';"
        },
        {
            "id": "ex_8",
            "question": "Who are the top 3 customers from Chicago by total orders?",
            "sql": "SELECT c.customer_id, c.first_name, c.last_name, COUNT(o.order_id) AS order_count FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE c.city = 'Chicago' GROUP BY c.customer_id ORDER BY order_count DESC LIMIT 3;"
        },
        {
            "id": "ex_9",
            "question": "What is the most popular product by quantity sold?",
            "sql": "SELECT p.product_name, SUM(oi.quantity) AS total_quantity_sold FROM products p JOIN order_items oi ON p.product_id = oi.product_id GROUP BY p.product_id ORDER BY total_quantity_sold DESC LIMIT 1;"
        },
        {
            "id": "ex_10",
            "question": "Show the count of canceled, completed, and pending orders.",
            "sql": "SELECT status, COUNT(order_id) AS status_count FROM orders GROUP BY status;"
        }
    ]

    # Insert into ChromaDB
    collection.upsert(
        ids=[ex["id"] for ex in examples],
        documents=[ex["question"] for ex in examples],
        metadatas=[{"sql": ex["sql"]} for ex in examples]
    )

    print(f"✅ Successfully seeded {collection.count()} Few-Shot Question-SQL pairs into ChromaDB!")

if __name__ == "__main__":
    init_vector_db()