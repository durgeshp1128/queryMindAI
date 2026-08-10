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
    # examples = [
    #     {
    #         "id": "ex_1",
    #         "question": "What are the top 5 highest spending customers?",
    #         "sql": "SELECT c.customer_id, c.first_name, c.last_name, SUM(o.total_amount) AS total_spent FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE o.status = 'completed' GROUP BY c.customer_id ORDER BY total_spent DESC LIMIT 5;"
    #     },
    #     {
    #         "id": "ex_2",
    #         "question": "Which product categories generated the most total revenue?",
    #         "sql": "SELECT cat.category_name, SUM(oi.subtotal) AS category_revenue FROM categories cat JOIN products p ON cat.category_id = p.category_id JOIN order_items oi ON p.product_id = oi.product_id JOIN orders o ON oi.order_id = o.order_id WHERE o.status != 'canceled' GROUP BY cat.category_name ORDER BY category_revenue DESC;"
    #     },
    #     {
    #         "id": "ex_3",
    #         "question": "List all customers who have not placed any orders.",
    #         "sql": "SELECT c.customer_id, c.first_name, c.last_name, c.email FROM customers c LEFT JOIN orders o ON c.customer_id = o.customer_id WHERE o.order_id IS NULL;"
    #     },
    #     {
    #         "id": "ex_4",
    #         "question": "What is the average order value (AOV) per payment method?",
    #         "sql": "SELECT p.payment_method, AVG(p.amount) AS avg_payment_amount FROM payments p WHERE p.payment_status = 'success' GROUP BY p.payment_method ORDER BY avg_payment_amount DESC;"
    #     },
    #     {
    #         "id": "ex_5",
    #         "question": "How many orders were placed each month in 2024?",
    #         "sql": "SELECT strftime('%Y-%m', order_date) AS month, COUNT(order_id) AS total_orders FROM orders WHERE strftime('%Y', order_date) = '2024' GROUP BY month ORDER BY month ASC;"
    #     },
    #     {
    #         "id": "ex_6",
    #         "question": "Which products are low in stock (less than 20 items remaining)?",
    #         "sql": "SELECT product_id, product_name, stock_quantity FROM products WHERE stock_quantity < 20 AND is_active = 1 ORDER BY stock_quantity ASC;"
    #     },
    #     {
    #         "id": "ex_7",
    #         "question": "Find the total revenue generated from PayPal payments.",
    #         "sql": "SELECT SUM(amount) AS total_paypal_revenue FROM payments WHERE payment_method = 'paypal' AND payment_status = 'success';"
    #     },
    #     {
    #         "id": "ex_8",
    #         "question": "Who are the top 3 customers from Chicago by total orders?",
    #         "sql": "SELECT c.customer_id, c.first_name, c.last_name, COUNT(o.order_id) AS order_count FROM customers c JOIN orders o ON c.customer_id = o.customer_id WHERE c.city = 'Chicago' GROUP BY c.customer_id ORDER BY order_count DESC LIMIT 3;"
    #     },
    #     {
    #         "id": "ex_9",
    #         "question": "What is the most popular product by quantity sold?",
    #         "sql": "SELECT p.product_name, SUM(oi.quantity) AS total_quantity_sold FROM products p JOIN order_items oi ON p.product_id = oi.product_id GROUP BY p.product_id ORDER BY total_quantity_sold DESC LIMIT 1;"
    #     },
    #     {
    #         "id": "ex_10",
    #         "question": "Show the count of canceled, completed, and pending orders.",
    #         "sql": "SELECT status, COUNT(order_id) AS status_count FROM orders GROUP BY status;"
    #     }
    # ]
    examples = [
        # --- ORIGINAL CORE EXAMPLES ---
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
            "question": "Which products are low in stock (less than 20 items remaining)?",
            "sql": "SELECT product_id, product_name, stock_quantity FROM products WHERE stock_quantity < 20 AND is_active = 1 ORDER BY stock_quantity ASC;"
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

        # --- NEW BENCHMARK-TARGETED EXAMPLES ---
        
        # 1. LEFT JOIN (Missing/Unmatched Records Pattern)
        {
            "id": "ex_6",
            "question": "List all customers who have never placed an order.",
            "sql": "SELECT c.customer_id, c.first_name, c.last_name FROM customers c LEFT JOIN orders o ON c.customer_id = o.customer_id WHERE o.order_id IS NULL;"
        },
        
        # 2. HAVING Clause (Aggregated Threshold Filtering)
        {
            "id": "ex_7",
            "question": "Find customers who have spent more than 500 dollars in total.",
            "sql": "SELECT c.customer_id, c.first_name, c.last_name, SUM(o.total_amount) AS total_spent FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.customer_id HAVING total_spent > 500;"
        },
        
        # 3. Multi-Table JOIN with Payment & Order Filters
        {
            "id": "ex_8",
            "question": "Find all completed orders placed with PayPal.",
            "sql": "SELECT o.order_id, o.customer_id, p.amount FROM orders o JOIN payments p ON o.order_id = p.order_id WHERE o.status = 'completed' AND p.payment_method = 'paypal' AND p.payment_status = 'success';"
        },

        # 4. Multi-Condition Filtering (Category ID + Stock Range)
        {
            "id": "ex_9",
            "question": "List all products in category 2 with stock greater than 50.",
            "sql": "SELECT product_id, product_name, stock_quantity FROM products WHERE category_id = 2 AND stock_quantity > 50;"
        },

        # 5. Multi-Table Itemized Breakdown by Order ID
        {
            "id": "ex_10",
            "question": "Find order details for order ID 10 including product names and subtotal.",
            "sql": "SELECT oi.order_id, p.product_name, oi.quantity, oi.subtotal FROM order_items oi JOIN products p ON oi.product_id = p.product_id WHERE oi.order_id = 10;"
        },

        # 6. IN Clause / Edge Cases with Multiple Status Strings
        {
            "id": "ex_11",
            "question": "Show all payments that have a pending or failed status.",
            "sql": "SELECT payment_id, order_id, amount, payment_status FROM payments WHERE payment_status IN ('pending', 'failed');"
        },

        # 7. Explicit Column Selection (Preventing SELECT * for Active Products)
        {
            "id": "ex_12",
            "question": "Show all active products in the store.",
            "sql": "SELECT product_id, product_name, price FROM products WHERE is_active = 1;"
        },

        # 8. Top N Expensive Products Ordering
        {
            "id": "ex_13",
            "question": "List the top 5 most expensive products.",
            "sql": "SELECT product_id, product_name, price FROM products ORDER BY price DESC LIMIT 5;"
        },

        # 9. Simple Category JOIN
        {
            "id": "ex_14",
            "question": "List each product along with its category name.",
            "sql": "SELECT p.product_name, c.category_name FROM products p JOIN categories c ON p.category_id = c.category_id;"
        },

        # 10. Customer Order Items Aggregation by Specific Order ID
        {
            "id": "ex_15",
            "question": "Show customer names and total quantity of items purchased for order ID 1.",
            "sql": "SELECT c.first_name, c.last_name, SUM(oi.quantity) AS total_items FROM customers c JOIN orders o ON c.customer_id = o.customer_id JOIN order_items oi ON o.order_id = oi.order_id WHERE o.order_id = 1 GROUP BY c.customer_id;"
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