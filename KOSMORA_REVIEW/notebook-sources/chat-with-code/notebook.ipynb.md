# Исходные ячейки: chat-with-code/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Chat with Code - RAG System with Codex Validation

This notebook demonstrates a Retrieval-Augmented Generation (RAG) system that allows you to chat with code repositories. The system uses LlamaIndex for orchestration and Milvus for vector search, combined with Cleanlab Codex for response validation.

## Features
- Clone and parse GitHub repositories
- Support for multiple file types (Python, JavaScript, TypeScript, Markdown, Jupyter notebooks)
- Vector-based similarity search using Milvus
- Custom prompt templates for better responses
- Response validation using Cleanlab Codex

## Ячейка 1: markdown

## 📦 Dependencies and Imports

Setting up all required libraries for the RAG system:

## Ячейка 2: code

````text
import os
import re
import glob
import subprocess
import nest_asyncio
from dotenv import load_dotenv
from IPython.display import Markdown, display

from llama_index.core import Settings
from llama_index.llms.openrouter import OpenRouter
from llama_index.core import PromptTemplate
from llama_index.core import SimpleDirectoryReader
from llama_index.core import VectorStoreIndex
from llama_index.core.storage.storage_context import StorageContext
from llama_index.core.node_parser import CodeSplitter, MarkdownNodeParser

from llama_index.core.indices.vector_store.base import VectorStoreIndex
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.vector_stores.milvus import MilvusVectorStore
````

## Ячейка 3: markdown

## 🔧 Codex Client Setup

Initialize Cleanlab Codex for response validation and quality assurance.

## Ячейка 4: code

````text
from cleanlab_codex.project import Project
from cleanlab_codex.client import Client

# Set your Codex API key (from https://codex.cleanlab.ai/account)
os.environ["CODEX_API_KEY"] = "<your_codex_api_key_here>"

# Initialize Codex client and project
codex_client = Client()
project = codex_client.create_project(name="Chat-with-Code", description="Code RAG project with added validation of Codex")
access_key = project.create_access_key("test-access-key")
project = Project.from_access_key(access_key)
````

## Ячейка 5: markdown

## ⚙️ Configuration Setup

## Ячейка 6: code

````text
# Allows nested access to the event loop
nest_asyncio.apply()
````

## Ячейка 7: markdown

## 🤖 LLM and Embedding Model Configuration

Setting up OpenRouter LLM and HuggingFace embedding model for the RAG pipeline.

## Ячейка 8: code

````text
# Setting up the LLM
llm = OpenRouter(api_key="<your_openrouter_api_key_here>", model="qwen/qwen3-coder:free")
Settings.llm = llm

# Setting up the embedding model
Settings.embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-base-en-v1.5")
````

## Ячейка 9: markdown

## 🛠️ Utility Functions

Core functions for repository handling, document parsing, and index creation.

## Ячейка 10: code

````text
def parse_github_url(url):
    pattern = r"https://github\.com/([^/]+)/([^/]+)"
    match = re.match(pattern, url)
    return match.groups() if match else (None, None)

def clone_github_repo(repo_url):    
    try:
        print('Cloning the repo ...')
        result = subprocess.run(["git", "clone", repo_url], check=True, text=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        print(f"Failed to clone repository: {e}")
        return None

def validate_owner_repo(owner, repo):
    return bool(owner) and bool(repo)

def parse_docs_by_file_types(ext, language, input_dir_path):
    try:
        files = glob.glob(f"{input_dir_path}/**/*{ext}", recursive=True)
        
        if len(files) > 0:
            loader = SimpleDirectoryReader(
                input_dir=input_dir_path, required_exts=[ext], recursive=True
            )
            docs = loader.load_data()

            parser = (
                MarkdownNodeParser()
                if ext == ".md"
                else CodeSplitter.from_defaults(language=language)
            )
            return parser.get_nodes_from_documents(docs)
        else:
            return []
    except Exception as e:
        print(f'Exception {e} occurred while parsing docs into nodes of file type {ext}')
        return []

def create_index(nodes):
    vector_store = MilvusVectorStore(uri="http://localhost:19530", dim=768, overwrite=True)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    index = VectorStoreIndex(
        nodes,
        storage_context=storage_context,
    )
    return index
````

## Ячейка 11: markdown

## 🔍 Query Engine Setup

Main function to set up the complete RAG pipeline for a given GitHub repository.

## Ячейка 12: code

````text
def setup_query_engine(github_url):
    owner, repo = parse_github_url(github_url)
    
    if validate_owner_repo(owner, repo):
        # Clone the GitHub repo & save it in a directory
        # input_dir_path = f"/teamspace/studios/this_studio/{repo}"
        input_dir_path = os.path.join(os.getcwd(), repo)

        if os.path.exists(input_dir_path):
            pass
        else:
            clone_github_repo(github_url)

        try:
            file_types = {
                ".md": "markdown",
                ".py": "python",
                ".ipynb": "python",
                ".js": "javascript",
                ".ts": "typescript"
            }

            nodes = []
            for ext, language in file_types.items():
                nodes += parse_docs_by_file_types(ext, language, input_dir_path)

            # ====== Create vector store index ======
            try:
                index = create_index(nodes)
            except:
                index = VectorStoreIndex(nodes=nodes, show_progress=True)

            # TODO try async index creation for faster emebdding generation & persist it to memory!
            # index = VectorStoreIndex(docs, use_async=True)

            # ====== Setup a query engine ======
            query_engine = index.as_query_engine(similarity_top_k=4)
            
            # ====== Customise prompt template ======
            qa_prompt_tmpl_str = (
                "Context information is below.\n"
                "---------------------\n"
                "{context_str}\n"
                "---------------------\n"
                "Given the context information above, I want you to think step by step to answer the query in a crisp manner. "
                "First, carefully check if the answer can be found in the provided context. "
                "If the answer is available in the context, use that information to respond. "
                "If the answer is not available in the context or the context is insufficient, "
                "you may use your own knowledge to provide a helpful response. "
                "Only say 'I don't know!' if you cannot answer the question using either the context or your general knowledge.\n"
                "Query: {query_str}\n"
                "Answer: "
            )

            qa_prompt_tmpl = PromptTemplate(qa_prompt_tmpl_str)

            query_engine.update_prompts(
                {"response_synthesizer:text_qa_template": qa_prompt_tmpl}
            )

            if nodes:
                print("Data loaded successfully!!")
                print("Ready to chat!!")
            else:
                print("No data found, check if the repository is not empty!")
            
            return query_engine

        except Exception as e:
            print(f"An error occurred: {e}")
    else:
        print('Invalid github repo, try again!')
        return None
````

## Ячейка 13: markdown

## 🚀 Usage Example

Let's test the system with a sample repository.

## Ячейка 14: code

````text
# Provide url to the repository you want to chat with
github_url = "https://github.com/sitamgithub-MSIT/ClassyText"

query_engine = setup_query_engine(github_url=github_url)
````

## Ячейка 15: markdown

## 💬 Basic Query Test

Testing the query engine with a simple question.

## Ячейка 16: code

````text
response = query_engine.query("What is the name of the Zero-shot Text Classification model used in this project?")
display(Markdown(str(response)))
````

## Ячейка 17: markdown

## ✅ Codex-Enhanced Query System

Enhanced query function that includes Cleanlab Codex validation for improved response quality and reliability.

## Ячейка 18: code

````text
fallback_response = "I'm sorry, I couldn't find an answer for that — can I help with something else?"


def codex_validated_query(query_engine, user_query):
    # Step 1: Get response from your RAG pipeline
    response_obj = query_engine.query(user_query)
    initial_response = str(response_obj)

    # Step 2: Convert to message format
    context = response_obj.source_nodes
    context_str = "\n".join([n.node.text for n in context])

    prompt_template = (
        "Context information is below.\n"
        "---------------------\n"
        "{context}\n"
        "---------------------\n"
        "Given the context information above, I want you to think step by step to answer the query in a crisp manner. "
        "First, carefully check if the answer can be found in the provided context. "
        "If the answer is available in the context, use that information to respond. "
        "If the answer is not available in the context or the context is insufficient, "
        "you may use your own knowledge to provide a helpful response. "
        "Only say 'I don't know!' if you cannot answer the question using either the context or your general knowledge.\n"
        "Query: {query}\n"
        "Answer: "
    )
    user_prompt = prompt_template.format(context=context_str, query=user_query)
    messages = [{
        "role": "user",
        "content": user_prompt,
    }]

    # Step 3: Validate with Codex
    result = project.validate(
        messages=messages,
        query=user_query,
        context=context_str,
        response=initial_response,
    )

    # Step 4: Return Codex-evaluated final response
    final_response = (
        result.expert_answer
        if result.expert_answer and result.escalated_to_sme
        else fallback_response if result.should_guardrail
        else initial_response
    )

    # Step 5: Return both final response and full validation info
    return {
        "final_response": final_response,
        "validation_results": result.model_dump()
    }
````

## Ячейка 19: markdown

## 🧪 Testing Codex-Validated Responses

Compare the validated response with detailed validation metrics.

## Ячейка 20: code

````text
output = codex_validated_query(query_engine, "What is the name of the Zero-shot Text Classification model used in this project?")

print("Final Answer:\n", output["final_response"])
print("\nValidation Results:")
for k, v in output["validation_results"].items():
    print(f"  {k}: {v}")
````