# Исходные ячейки: context-engineering-pipeline/context_engineering_notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# **Context Engineering with [Pixeltable](https://pixeltable.com)**

## Ячейка 1: markdown

# LLM Setup

This section initializes the OpenAI API key required for LLM used in the context engineering demo. The code securely handles API key management.

## Ячейка 2: code

````text
import os
import getpass
# Check if the OPENAI_API_KEY environment variable is set
if 'OPENAI_API_KEY' not in os.environ:
    # If not set, prompt the user to enter their securely
    os.environ['OPENAI_API_KEY'] = getpass.getpass('OpenAI API Key:')
````

## Ячейка 3: markdown

# Core Libraries:
- **[pixeltable](https://docs.pixeltable.com)**: The main framework for managing multimodal data and AI workflows
- **[pixelagent](https://github.com/pixeltable/pixelagent)**: Agent framework for building AI assistants with tool capabilities

## Ячейка 4: markdown

# RAG - Document Search

This section demonstrates **Retrieval Augmented Generation (RAG)**, a powerful technique that combines the generative capabilities of large language models with external knowledge retrieval.

## Ячейка 5: code

````text
import pixeltable as pxt
from pixeltable.iterators import DocumentSplitter
from pixeltable.functions.huggingface import sentence_transformer

# Drop the existing directory and create a new one for context engineering
pxt.drop_dir("context_engineering", if_not_exists="ignore", force=True)
pxt.create_dir("context_engineering")

# Create a Pixeltable table named "documents" with a Document column for PDFs
documents_t = pxt.create_table(
    "context_engineering.documents",
    {"pdf": pxt.Document}
)
# Create a Pixeltable view named "document_chunks" from the "documents" table
# Use DocumentSplitter to break down documents into chunks based on token limit
documents_chunks = pxt.create_view(
    "context_engineering.document_chunks",
    documents_t,
    iterator=DocumentSplitter.create(
        document=documents_t.pdf,
        separators="token_limit",
        limit=300
    )
)

# Define the embedding model to be used for text embedding
embed_model = sentence_transformer.using(model_id="intfloat/e5-large-v2")
# Add an embedding index to the "text" column of the document_chunks view using the defined embedding model
documents_chunks.add_embedding_index(column="text", string_embed=embed_model)
````

## Ячейка 6: markdown

## Document Ingestion

This section demonstrates the process of loading financial documents into our RAG system. The documents serve as the knowledge base that the AI agent will query to answer user questions.

## Ячейка 7: code

````text
# Get existing Pixeltable tables for documents and document chunks
documents_t = pxt.get_table("context_engineering.documents")
documents_chunks = pxt.get_table("context_engineering.document_chunks")

# Base URL for the documents
DOCUMENT_URL = ("https://github.com/pixeltable/pixeltable/raw/release/docs/resources/rag-demo/")

# List of document filenames
document_urls = [
    DOCUMENT_URL + doc for doc in [
        "Argus-Market-Digest-June-2024.pdf",
        "Company-Research-Alphabet.pdf",
        # "Zacks-Nvidia-Report.pdf", # Commented out to exclude this document
    ]
]
# Insert the document URLs into the documents table
documents_t.insert({"pdf": url} for url in document_urls)
````

## Ячейка 8: code

````text
documents_chunks.collect()
````

## Ячейка 9: markdown

## Tools

This section defines custom tools that extend the AI agent's capabilities beyond text generation. These tools demonstrate how to create specialized functions for specific domains and use cases.

## Ячейка 10: code

````text
@pxt.query
def find_documents(query: str) -> dict:
    """Function to return top five chunks from financial documents that are most similar to query, ranked by vector similarity for use of RAG."""
    # Calculate the similarity between the query and the text of the document chunks using the 'similarity' function
    sim = documents_chunks.text.similarity(query)
    # Order the document chunks by similarity in descending order, select the text and similarity score, and limit to the top 5 results
    return (
        documents_chunks.order_by(sim, asc=False)
        .select(
            documents_chunks.text,
            similarity=sim
        )
        .limit(5)
    )
````

## Ячейка 11: markdown

MCP allows to use of tools exposed by the MCP server and integrates external services and custom logic into agentic workflows. Tools exposed by the MCP server can be used as Pixeltable UDFs.

## Ячейка 12: code

````text
# Connect to the Alpha Vantage stock market MCP server. 
# For an API key, visit https://www.alphavantage.co/support/#api-key
# This returns a list of UDFs, one for each tool.

api_key = "<api-key>"  # TODO: Replace <api-key> with your actual Alpha Vantage API key.
udfs = pxt.mcp_udfs(f"https://mcp.alphavantage.co/mcp?apikey={api_key}")

# Get available tools with: print(list(enumerate(udfs)))
get_exchange_rate = udfs[30]
````

## Ячейка 13: markdown

## Agent

This section creates an intelligent AI agent that combines conversational capabilities with specialized tools. The agent represents the core orchestrator of our context engineering system.

## Ячейка 14: code

````text
from pixelagent.openai import Agent

# Define and initialize the Agent
tools_agent = Agent(
    name = "context_engineering.agent", # Name of the agent
    system_prompt=(
        "You are a tools-enabled AI assistant. "
        "Use `find_documents` for RAG/PDF-Search to retrieve the top-5 chunks as per user query and answer ONLY from those. "
        "If context is insufficient, say so explicitly. "
        "Use `get_exchange_rate` for realtime exchange rate for any pair of cryptocurrency (e.g., Bitcoin) or physical currency (e.g., USD). "
        "Be concise, factual, and avoid recursive tool calls."
    ),
    tools=pxt.tools(find_documents, get_exchange_rate), # Register the tools the agent can use
    reset=False, # Do not reset the agent's memory on initialization
    n_latest_messages=None # Keep all messages in memory
)
````

## Ячейка 15: markdown

## Tool Calling

This section demonstrates the agent in action, showcasing how it intelligently selects and uses appropriate tools based on the query content.

## Ячейка 16: code

````text
# Call the agent with a query to get a response using its defined tools.
print(tools_agent.tool_call("Give me a brief summary about Alphabet earnings."))
````

## Ячейка 17: code

````text
# Call the agent with a query to get the exchange rate between USD and BTC
print(tools_agent.tool_call("What is the exchange rate between USD and bitcoin?"))
````

## Ячейка 18: markdown

# Memory Management

## Ячейка 19: markdown

## Short-term Memory

This section explores the sophisticated memory system that enables the agent to maintain context across conversations and learn from interactions over time. The memory system operates on multiple levels to provide comprehensive context engineering.

## Ячейка 20: code

````text
# Get the memory table associated with the agent.
memory = pxt.get_table("context_engineering.agent.memory")
# Collect all data from the memory table.
memory.collect()
````

## Ячейка 21: code

````text
# Initialize an empty string to store the chat history
chat_history = ""
# Get the memory table from the Pixeltable database
memory = pxt.get_table("context_engineering.agent.memory")

# Collect the 'role' and 'content' columns from the memory table into a pandas DataFrame
df = memory.select(memory.role, memory.content).collect()
# Iterate through the DataFrame rows and format the chat history
for role, content in zip(df["role"], df["content"]):
    chat_history += f"{role}: {content}\n"

# Print the formatted chat history
print(chat_history)
````

## Ячейка 22: markdown

## Long-term Memory

**Purpose**: Creates persistent, searchable memory that enables semantic retrieval of historical interactions.

## Ячейка 23: code

````text
import pixeltable.functions as pxtf
from pixeltable.functions import huggingface

# Get the memory table from the Pixeltable database
memory = pxt.get_table("context_engineering.agent.memory")

# Add a computed column 'user_content' to the memory table by formatting the 'role' and 'content' columns
memory.add_computed_column(
    user_content=pxtf.string.format(
        "{0}: {1}", memory.role, memory.content
    ),
    if_exists="ignore", # Ignore if the column already exists
)
# Add a computed column 'embedding' to the memory table by applying the sentence_transformer function to the 'user_content' column
memory.add_computed_column(
    embedding=huggingface.sentence_transformer(memory.user_content, model_id='intfloat/e5-large-v2')
)

# Add an embedding index to the 'user_content' column for faster similarity search
memory.add_embedding_index(
    column="user_content",
    idx_name="user_content_idx", # Name of the index
    embedding=embed_model, # Embedding model to use
    if_exists="ignore", # Ignore if the index already exists
)
````

## Ячейка 24: code

````text
# Get the memory table from the Pixeltable database
memory = pxt.get_table("context_engineering.agent.memory")
# Collect all data from the memory table into a pandas DataFrame
memory.collect()
````

## Ячейка 25: markdown

### Integrate VectorDB

**Purpose**: Demonstrates integration with external vector databases for scalable memory management and advanced analytics.

## Ячейка 26: code

````text
from pathlib import Path

# Get the memory table from the Pixeltable database
memory = pxt.get_table("context_engineering.agent.memory")
# Collect all data from the memory table
memory.collect()

# Export selected columns (message_id, user_content, embedding) from the memory table
# to a LanceDB database located at 'vector_db' with a table named 'semantic_memory'.
# If the table exists, append the data.
pxt.io.export_lancedb(
    memory.select(memory.message_id, memory.user_content, memory.embedding),
    Path('vector_db'),
    'semantic_memory',
    if_exists='append'
)
````

## Ячейка 27: code

````text
import lancedb

# Connect to the LanceDB database located at 'vector_db'
db = lancedb.connect('vector_db')
# Open the 'semantic_memory' table in the database and convert it to a pandas DataFrame
results = db.open_table('semantic_memory').to_pandas()
# Display the resulting DataFrame
results
````

## Ячейка 28: markdown

### Vector Search

**Purpose**: Implements sophisticated semantic search capabilities for memory retrieval using advanced vector similarity techniques.

## Ячейка 29: code

````text
import lancedb
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer

def search_memory(query: str) -> list[dict]:
    """Top-k search over LanceDB and return cosine similarity scores."""
    # Initialize the SentenceTransformer model for creating embeddings if it hasn't been already
    if not hasattr(search_memory, "_model"):
        search_memory._model = SentenceTransformer("intfloat/e5-large-v2")
    model = search_memory._model

    # Encode the query into a vector
    q = model.encode("query: " + query, normalize_embeddings=False).astype("float32")
    q_norm = np.linalg.norm(q) + 1e-12

    # Connect to the LanceDB database and open the table
    db = lancedb.connect('/content/vector_db')
    tbl = db.open_table('semantic_memory')

    # Perform a vector search using the encoded query and limit the results
    df = tbl.search(q, vector_column_name="embedding").limit(5).to_pandas()

    # Define a helper function to calculate cosine similarity
    def _cos(v):
        v = np.asarray(v, dtype="float32")
        return float(np.dot(v, q) / ((np.linalg.norm(v) + 1e-12) * q_norm))

    # Calculate cosine similarity for each result and add it as a new column
    df["cosine_similarity"] = [ _cos(v) for v in df["embedding"] ]
    # Sort the results by cosine similarity in descending order
    df = df.sort_values("cosine_similarity", ascending=False)

    # Return the results as a list of dictionaries
    return [
        {
            "message_id": row["message_id"],
            "user_content": row["user_content"],
            "cosine_similarity": float(row["cosine_similarity"]),
        }
        for _, row in df.iterrows()
    ]
````

## Ячейка 30: code

````text
# Call the search_memory function with a query and print the results
hits = search_memory("Give me the exchange rate of USD and BTC?")
hits
````

## Ячейка 31: markdown

# Response Generation

This section demonstrates the complete context engineering pipeline for generating intelligent, context-aware responses. It combines multiple sources of information to create comprehensive, accurate answers.

## Ячейка 32: markdown

## Prepare Context

**Purpose**: Demonstrates the systematic assembly of comprehensive context from multiple information sources.

## Ячейка 33: code

````text
user_query = "Summarize my previous conversations with you!"
````

## Ячейка 34: code

````text
# Tool calling output
tool_ctx = tools_agent.tool_call(user_query)
````

## Ячейка 35: code

````text
# Initialize an empty string to store the chat history
chat_history = ""
# Get the memory table from the Pixeltable database
memory = pxt.get_table("context_engineering.agent.memory")

# Collect the 'role' and 'content' columns from the memory table into a pandas DataFrame
df = memory.select(memory.role, memory.content).collect()
# Iterate through the DataFrame rows and format the chat history
for role, content in zip(df["role"], df["content"]):
    chat_history += f"{role}: {content}\n"
````

## Ячейка 36: code

````text
long_term_ctx = search_memory(user_query)
````

## Ячейка 37: code

````text
# Prepare unified context
context_prompt = f"""
========================
USER QUERY
========================
{user_query}

========================
CONTEXT BLOCKS (read-only)
========================
[TOOL OUTPUT]
- May include:
  • RAG output: response that includes PDF/Document search
  • Exchange rate: exchange details between physical and crypto currency finance
{tool_ctx or "(none)"}

[USER CHAT HISTORY]
- Prefer recent messages if conflicting
- Messages are sorted means latest messages will be at the bottom
{chat_history or "(none)"}

[LONG-TERM USER DB HITS]
- Vector search results (highest cosine first)
- Only include items that look relevant to the query
{long_term_ctx or "(none)"}
"""
context_prompt
````

## Ячейка 38: markdown

## Summarization

**Purpose**: Implements intelligent context compression to manage token budgets while preserving essential information for high-quality response generation.

## Ячейка 39: code

````text
from pixelagent.openai import Agent

# Define the system prompt for the summarizer agent
SUMMARIZER_SYSTEM_PROMPT = """
You are a compression assistant.
Condense the given block into a concise, lossless summary sized to the target.
Keep original identifiers, references. Remove redundancy, and off-topic lines.
Preserve key facts, numbers. Output only the summary text.
"""

# Initialize the summarizer agent with the defined system prompt
summarizer_agent = Agent(
    name="summarizer_agent",
    system_prompt=SUMMARIZER_SYSTEM_PROMPT
)
````

## Ячейка 40: code

````text
import tiktoken

# Get the cl100k_base encoding for token counting
_enc = tiktoken.get_encoding("cl100k_base")

# Function to count the number of tokens in a string
def count_tokens(s: str) -> int:
    return len(_enc.encode(s or ""))

# Function to check if a string is within the maximum token budget
def within_budget(s: str, max_tokens: int) -> bool:
    return count_tokens(s) <= max_tokens
````

## Ячейка 41: code

````text
def maybe_summarize_block(
    text: str,
    block_name: str,
    max_tokens: int,
    target_tokens: int | None = None,
    model: str = "gpt-4o-mini",
) -> str:
    """If `text` > max_tokens, compress to ~target_tokens (or ~max_tokens//2 if not given)."""
    # Clean and prepare the text
    text = (str(text) or "").strip()
    if not text or within_budget(text, max_tokens):
        return text

    # Determine the target token count for the summary
    tgt = target_tokens or max(256, max_tokens // 2)

    # Prepare the user message for the summarizer agent
    user_msg = (
        f"BLOCK NAME: {block_name}\n"
        f"TARGET SIZE: ~{tgt} tokens\n\n"
        f"CONTENT START\n{text}\nCONTENT END"
    )

    # Call the summarizer agent to get the summary
    resp = summarizer_agent.chat(messages=user_msg, model=model)
    return resp.choices[0].message.content.strip()
````

## Ячейка 42: code

````text
def build_context_prompt_with_summarization(
    user_query: str,
    tool_ctx: str,
    chat_history: str,
    long_term_ctx: str,
    tool_budget: int = 1200,
    chat_budget: int = 900,
    mem_budget: int  = 900,
    model: str = "gpt-4o-mini",
) -> str:
    # Summarize each context block if it exceeds the token budget
    tool_ctx_s = maybe_summarize_block(tool_ctx, "TOOL OUTPUT", max_tokens=tool_budget, model=model)
    chat_hist_s = maybe_summarize_block(chat_history, "USER CHAT HISTORY", max_tokens=chat_budget, model=model)
    mem_ctx_s  = maybe_summarize_block(long_term_ctx, "LONG-TERM USER DB HITS", max_tokens=mem_budget, model=model)

    # Construct the final context prompt with the (potentially summarized) context blocks
    return f"""
========================
USER QUERY
========================
{user_query}

========================
CONTEXT BLOCKS (read-only)
========================
[TOOL OUTPUT]
- May include:
  • RAG output: response that includes PDF/Document search
  • Exchange rate: exchange details between physical and crypto currency finance
{tool_ctx_s or "(none)"}

[USER CHAT HISTORY]
- Prefer recent messages if conflicting
- Messages are sorted means latest messages will be at the bottom
{chat_hist_s or "(none)"}

[LONG-TERM USER DB HITS]
- Vector search results (highest cosine first)
- Only include items that look relevant to the query
{mem_ctx_s or "(none)"}
""".strip()
````

## Ячейка 43: code

````text
# Build the context prompt with summarization for each block
context_prompt = build_context_prompt_with_summarization(
    user_query=user_query,
    tool_ctx=tool_ctx,
    chat_history=chat_history,
    long_term_ctx=long_term_ctx,
)
context_prompt
````

## Ячейка 44: markdown

## Final Response Agent

**Purpose**: The culminating component that synthesizes all context sources into coherent, accurate, and helpful responses.

## Ячейка 45: code

````text
from pixelagent.openai import Agent

SYSTEM_PROMPT = f"""
**1. Role & Objective**

You are a specialized AI assistant for context-based response generation. Your primary objective is to synthesize information from a given set of context blocks to answer a user's query directly and accurately.

**2. Core Workflow**

1.  **Analyze the Query:** Deconstruct the user's request to identify the specific information needed.
2.  **Review Context:** Scrutinize all provided context blocks: `[TOOL OUTPUT]`, `[USER CHAT HISTORY]`, and `[LONG-TERM USER DB HITS]`.
3.  **Synthesize Information:** Extract and combine only the relevant facts from the context to construct your answer.
4.  **Resolve Conflicts:** If the context blocks contain conflicting information, you **must** adhere to the following hierarchy of authority:
    1.  `[TOOL OUTPUT]` (Most definitive data for external tool calling either as RAG/Document search or stock market info for exchange details)
    2.  `[LONG-TERM USER DB HITS]` (Established user all chat session information till date stored in vector db retrieved as embedding similarity search)
    3.  `[USER CHAT HISTORY]` (Conversational chat context for current user session)
5.  **Handle Insufficiency:** If the combined context does not contain the necessary information to answer the query, answer the query with your existing knowledge.

**3. Strict Constraints**

* **No External Knowledge:** Your response must be derived *exclusively* from the provided context. Do not use any pre-existing knowledge.
* **No Speculation:** Do not infer information, fill in gaps, or make assumptions that are not explicitly stated in the context.

**4. Output Style**

* **Concise & Factual:** Deliver a short, direct answer to the user's query. Avoid conversational filler or unnecessary prose.
* **Actionable:** When the context supports it, frame the response in a way that helps the user complete a task or make a decision.
* **Neutral Tone:** Maintain an impartial, data-driven tone.
"""

# Initialize response agent
response_agent = Agent(
    name="response_generation",
    system_prompt=SYSTEM_PROMPT
)
````

## Ячейка 46: code

````text
print(response_agent.chat(context_prompt))
````

## Ячейка 47: markdown

# Conclusion

This comprehensive context engineering demo showcases a sophisticated AI system that combines multiple advanced technologies to create intelligent, context-aware responses. The implementation demonstrates how modern AI applications can move beyond simple query-response patterns to create truly adaptive, learning systems.