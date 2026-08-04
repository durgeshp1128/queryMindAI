import sqlite3
import random
from datetime import datetime, timedelta
from faker import Faker

# Initialize Faker generator
fake = Faker()
Faker.seed(42)  # For reproducible random data
random.seed(42)

DB_NAME = "app.db"

# Seed volume configurations
NUM_CUSTOMERS = 1000
NUM_CATEGORIES = 15
NUM_PRODUCTS = 250
NUM_ORDERS = 1200
MAX_ITEMS_PER_ORDER = 5
NUM_PAYMENTS = 1100  # Some orders might be unpaid/canceled


def create_schema(cursor):
    """Creates 6 linked e-commerce tables with foreign key constraints."""
    
    # Enable foreign key support in SQLite
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Customers Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        created_at DATETIME NOT NULL
    );
    """)

    # 2. Categories Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS categories (
        category_id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_name TEXT UNIQUE NOT NULL,
        description TEXT
    );
    """)

    # 3. Products Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        product_id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL,
        category_id INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        stock_quantity INTEGER NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        FOREIGN KEY (category_id) REFERENCES categories (category_id)
    );
    """)

    # 4. Orders Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        order_id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        order_date DATETIME NOT NULL,
        status TEXT CHECK(status IN ('completed', 'pending', 'canceled', 'shipped')) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    );
    """)

    # 5. Order Items Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS order_items (
        order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        subtotal DECIMAL(10, 2) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products (product_id)
    );
    """)

    # 6. Payments Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        payment_method TEXT CHECK(payment_method IN ('credit_card', 'paypal', 'bank_transfer', 'apple_pay')) NOT NULL,
        payment_date DATETIME NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        payment_status TEXT CHECK(payment_status IN ('success', 'failed', 'refunded')) NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders (order_id)
    );
    """)


def seed_data(conn, cursor):
    """Generates synthetic relational data and populates the database."""
    print("🌱 Seeding Customers...")
    customers = []
    start_date = datetime(2023, 1, 1)
    
    for _ in range(NUM_CUSTOMERS):
        cust_created = fake.date_time_between(start_date=start_date, end_date='now')
        customers.append((
            fake.first_name(),
            fake.last_name(),
            fake.unique.email(),
            fake.city(),
            fake.country(),
            cust_created.strftime("%Y-%m-%d %H:%M:%S")
        ))
    cursor.executemany("""
        INSERT INTO customers (first_name, last_name, email, city, country, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, customers)

    print("🌱 Seeding Categories...")
    category_names = [
        "Electronics", "Computers", "Smart Home", "Apparel", "Footwear",
        "Home & Kitchen", "Beauty & Care", "Sports & Outdoors", "Books",
        "Toys & Games", "Automotive", "Garden", "Pet Supplies", "Office Supplies", "Jewelry"
    ]
    categories = [(cat, fake.sentence(nb_words=6)) for cat in category_names]
    cursor.executemany("""
        INSERT INTO categories (category_name, description)
        VALUES (?, ?)
    """, categories)

    print("🌱 Seeding Products...")
    products = []
    for _ in range(NUM_PRODUCTS):
        prod_name = f"{fake.color_name().capitalize()} {fake.word().capitalize()} {random.choice(['Pro', 'Plus', 'Ultra', 'Lite', 'Standard'])}"
        category_id = random.randint(1, len(category_names))
        unit_price = round(random.uniform(5.99, 899.99), 2)
        stock_qty = random.randint(0, 500)
        is_active = random.choices([1, 0], weights=[0.9, 0.1])[0]
        products.append((prod_name, category_id, unit_price, stock_qty, is_active))

    cursor.executemany("""
        INSERT INTO products (product_name, category_id, unit_price, stock_quantity, is_active)
        VALUES (?, ?, ?, ?, ?)
    """, products)

    # Fetch product prices into memory for quick item subtotal calculations
    cursor.execute("SELECT product_id, unit_price FROM products")
    product_price_map = dict(cursor.fetchall())

    print("🌱 Seeding Orders & Order Items...")
    statuses = ['completed', 'pending', 'canceled', 'shipped']
    status_weights = [0.6, 0.1, 0.1, 0.2]

    for order_id in range(1, NUM_ORDERS + 1):
        customer_id = random.randint(1, NUM_CUSTOMERS)
        order_date = fake.date_time_between(start_date=start_date, end_date='now')
        order_status = random.choices(statuses, weights=status_weights)[0]

        # First insert place-holder order
        cursor.execute("""
            INSERT INTO orders (customer_id, order_date, status, total_amount)
            VALUES (?, ?, ?, 0.00)
        """, (customer_id, order_date.strftime("%Y-%m-%d %H:%M:%S"), order_status))

        # Generate order items for this order
        num_items = random.randint(1, MAX_ITEMS_PER_ORDER)
        chosen_products = random.sample(list(product_price_map.keys()), num_items)
        order_total = 0.0

        for prod_id in chosen_products:
            quantity = random.randint(1, 4)
            unit_price = product_price_map[prod_id]
            subtotal = round(quantity * unit_price, 2)
            order_total += subtotal

            cursor.execute("""
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
                VALUES (?, ?, ?, ?, ?)
            """, (order_id, prod_id, quantity, unit_price, subtotal))

        # Update the master order total
        cursor.execute("""
            UPDATE orders SET total_amount = ? WHERE order_id = ?
        """, (round(order_total, 2), order_id))

    print("🌱 Seeding Payments...")
    payment_methods = ['credit_card', 'paypal', 'bank_transfer', 'apple_pay']
    
    # Query non-canceled orders to assign payments
    cursor.execute("SELECT order_id, total_amount, order_date, status FROM orders WHERE status != 'canceled'")
    eligible_orders = cursor.fetchall()

    payments = []
    for ord_id, total, ord_date_str, ord_status in random.sample(eligible_orders, min(NUM_PAYMENTS, len(eligible_orders))):
        ord_date = datetime.strptime(ord_date_str, "%Y-%m-%d %H:%M:%S")
        pay_date = ord_date + timedelta(minutes=random.randint(2, 1440))
        method = random.choice(payment_methods)
        
        pay_status = 'success' if ord_status in ['completed', 'shipped'] else random.choice(['success', 'failed'])
        payments.append((ord_id, method, pay_date.strftime("%Y-%m-%d %H:%M:%S"), total, pay_status))

    cursor.executemany("""
        INSERT INTO payments (order_id, payment_method, payment_date, amount, payment_status)
        VALUES (?, ?, ?, ?, ?)
    """, payments)

    conn.commit()


def main():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    print(f"🛠️ Creating database schema in `{DB_NAME}`...")
    create_schema(cursor)

    print("🚀 Seeding realistic test data...")
    seed_data(conn, cursor)

    # Verification summary
    print("\n✅ Database successfully seeded! Table record counts:")
    tables = ['customers', 'categories', 'products', 'orders', 'order_items', 'payments']
    for table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"  • {table}: {count:,} rows")

    conn.close()


if __name__ == "__main__":
    main()