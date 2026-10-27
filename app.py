import os
import sqlite3
from typing import List, Dict
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import uvicorn

app = FastAPI(title="Splitwise Pro - Completo")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.path.join(DATA_DIR, "splitwise.db")
os.makedirs(DATA_DIR, exist_ok=True)

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            bank_account TEXT,
            bank_name TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            currency TEXT DEFAULT 'MXN'
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT NOT NULL,
            description TEXT NOT NULL,
            amount REAL NOT NULL,
            payer TEXT NOT NULL,
            category TEXT DEFAULT 'General',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (group_id) REFERENCES groups (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT NOT NULL,
            to_user TEXT NOT NULL,
            amount REAL NOT NULL,
            method TEXT DEFAULT 'SPEI',
            status TEXT DEFAULT 'Completado',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    default_users = [
        ("cesar@sena.edu.co", "1234", "Cesar Vega", "6461 8015 7024 8831 09", "STP / BBVA"),
        ("ana@sena.edu.co", "1234", "Ana Gómez", "4532 9011 2233 4455", "Santander"),
        ("mateo@sena.edu.co", "1234", "Mateo López", "1234 5678 9012 3456", "BBVA"),
        ("valeria@sena.edu.co", "1234", "Valeria Gómez", "9876 5432 1098 7654", "Banorte")
    ]
    for email, pwd, name, acc, bank in default_users:
        cursor.execute("INSERT OR IGNORE INTO users (email, password, name, bank_account, bank_name) VALUES (?, ?, ?, ?, ?)", (email, pwd, name, acc, bank))

    cursor.execute("SELECT COUNT(*) FROM groups")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO groups (id, name, currency) VALUES ('viaje_cancun', 'Viaje Cancún 2025', 'MXN')")
    
    conn.commit()
    conn.close()

init_db()

class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)

class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=4, max_length=200)
    name: str = Field(min_length=2, max_length=100)
    bank_account: str = Field(default="Sin cuenta", max_length=100)
    bank_name: str = Field(default="SPEI", max_length=80)

class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0, le=100000000)
    payer: str = Field(min_length=1, max_length=100)
    category: str = Field(default="General", max_length=40)

class PaymentCreate(BaseModel):
    from_user: str = Field(min_length=1, max_length=100)
    to_user: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0, le=100000000)
    method: str = Field(default="SPEI", max_length=30)

def calculate_detailed_balances(expenses: List[Dict], payments: List[Dict], all_users: List[str]) -> Dict:
    if not all_users:
        return {"net_balances": {}, "settlements": [], "total_spent": 0}
    
    paid_totals = {u: 0.0 for u in all_users}
    for exp in expenses:
        payer = exp["payer"]
        if payer in paid_totals:
            paid_totals[payer] += exp["amount"]
            
    total_spent = sum(paid_totals.values())
    share_per_person = total_spent / len(all_users) if all_users else 0.0
    
    net_balances = {u: paid_totals[u] - share_per_person for u in all_users}
    
    for pay in payments:
        frm = pay["from_user"]
        to = pay["to_user"]
        amt = pay["amount"]
        if frm in net_balances:
            net_balances[frm] += amt
        if to in net_balances:
            net_balances[to] -= amt

    debtors = []
    creditors = []
    for u, bal in net_balances.items():
        if bal < -0.01:
            debtors.append({'name': u, 'amount': -bal})
        elif bal > 0.01:
            creditors.append({'name': u, 'amount': bal})
            
    settlements = []
    i, j = 0, 0
    debtors_copy = [dict(d) for d in debtors]
    creditors_copy = [dict(c) for c in creditors]
    
    while i < len(debtors_copy) and j < len(creditors_copy):
        deb = debtors_copy[i]
        cred = creditors_copy[j]
        settle_amount = min(deb['amount'], cred['amount'])
        
        settlements.append({
            "from_user": deb['name'],
            "to_user": cred['name'],
            "amount": round(settle_amount, 2)
        })
        
        deb['amount'] -= settle_amount
        cred['amount'] -= settle_amount
        
        if deb['amount'] < 0.01:
            i += 1
        if cred['amount'] < 0.01:
            j += 1
            
    return {
        "net_balances": net_balances,
        "settlements": settlements,
        "total_spent": total_spent
    }

@app.post("/api/login")
def login_user(data: LoginRequest):
    conn = get_db_connection()
    user = conn.execute("SELECT * FROM users WHERE email = ? AND password = ?", (data.email.strip().lower(), data.password)).fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=400, detail="Correo o contraseña incorrectos")
    return {"success": True, "user": dict(user)}

@app.post("/api/users", status_code=201)
def create_user(user: UserCreate):
    if "@" not in user.email or "." not in user.email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=422, detail="Ingresa un correo electrónico válido")
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (email, password, name, bank_account, bank_name) VALUES (?, ?, ?, ?, ?)",
            (user.email.strip().lower(), user.password, user.name.strip(), user.bank_account, user.bank_name)
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="El correo ya está registrado")
    finally:
        conn.close()
    return {"message": "Usuario creado con éxito"}

@app.get("/api/dashboard")
def get_dashboard():
    conn = get_db_connection()
    expenses = [dict(e) for e in conn.execute("SELECT * FROM expenses ORDER BY id DESC").fetchall()]
    payments = [dict(p) for p in conn.execute("SELECT * FROM payments ORDER BY id DESC").fetchall()]
    users_rows = conn.execute("SELECT * FROM users").fetchall()
    conn.close()
    
    all_users_data = [dict(u) for u in users_rows]
    all_user_names = [u["name"] for u in all_users_data]
    calc = calculate_detailed_balances(expenses, payments, all_user_names)
    
    return {
        "total_acumulado": calc["total_spent"],
        "expenses": expenses,
        "payments": payments,
        "settlements": calc["settlements"],
        "net_balances": calc["net_balances"],
        "users_data": all_users_data,
        "users": all_user_names
    }

@app.post("/api/expenses", status_code=201)
def create_expense(expense: ExpenseCreate):
    if not expense.description.strip() or not expense.payer.strip():
        raise HTTPException(status_code=422, detail="El concepto y la persona que pagó son obligatorios")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO expenses (group_id, description, amount, payer, category) VALUES ('viaje_cancun', ?, ?, ?, ?)",
        (expense.description.strip(), expense.amount, expense.payer.strip(), expense.category)
    )
    conn.commit()
    conn.close()
    return {"message": "Gasto registrado"}

@app.post("/api/payments", status_code=201)
def create_payment(payment: PaymentCreate):
    if payment.from_user.strip() == payment.to_user.strip():
        raise HTTPException(status_code=422, detail="La persona que paga y quien recibe deben ser diferentes")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO payments (from_user, to_user, amount, method) VALUES (?, ?, ?, ?)",
        (payment.from_user, payment.to_user, payment.amount, payment.method)
    )
    conn.commit()
    conn.close()
    return {"message": "Pago registrado con éxito"}

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def read_root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5000)