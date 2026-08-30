import os
from dotenv import load_dotenv
load_dotenv('backend/.env')
from groq import Groq

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
models = client.models.list()
print("Available models:", [m.id for m in models.data])
