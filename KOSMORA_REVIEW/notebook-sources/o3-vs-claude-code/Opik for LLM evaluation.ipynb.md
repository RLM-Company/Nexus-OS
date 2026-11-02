# Исходные ячейки: o3-vs-claude-code/Opik for LLM evaluation.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import opik
opik.configure(use_local=False)
````

## Ячейка 1: code

````text
from dotenv import load_dotenv
load_dotenv()
````

## Ячейка 2: code

````text
import os
import re
import glob
import subprocess

from IPython.display import Markdown, display

from llama_index.core import Settings
from llama_index.llms.openai import OpenAI

from llama_index.core import PromptTemplate
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import VectorStoreIndex, ServiceContext, SimpleDirectoryReader


from llama_index.core import Settings
from llama_index.core import PromptTemplate
from llama_index.core import SimpleDirectoryReader
from llama_index.core import VectorStoreIndex
from llama_index.core.storage.storage_context import StorageContext
from llama_index.core.node_parser import CodeSplitter, MarkdownNodeParser
from llama_index.llms.openai import OpenAI
from llama_index.llms.anthropic import Anthropic
from llama_index.core.indices.vector_store.base import VectorStoreIndex
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.embeddings.fastembed import FastEmbedEmbedding
from llama_index.core import Settings
````

## Ячейка 3: markdown

# Trace RAG calls 

## Ячейка 4: code

````text
from llama_index.core import Settings
from llama_index.core.callbacks import CallbackManager
from opik.integrations.llama_index import LlamaIndexCallbackHandler

# A callback handler tp automatically log all LlamaIndex operations to Opik
opik_callback_handler = LlamaIndexCallbackHandler()

# Integrate handler into LlamaIndex's settings
Settings.callback_manager = CallbackManager([opik_callback_handler])
````

## Ячейка 5: code

````text

# Step 2: Define helper functions
def parse_github_url(url):
    """Extract owner and repo name from GitHub URL"""
    pattern = r"https://github\.com/([^/]+)/([^/]+)"
    match = re.match(pattern, url)
    return match.groups() if match else (None, None)

def clone_repo(repo_url):
    """Clone a GitHub repository"""
    return subprocess.run(["git", "clone", repo_url], check=True, text=True, capture_output=True)

def parse_docs_by_file_types(ext, language, input_dir_path):
    """Parse documents based on file extension"""
    files = glob.glob(f"{input_dir_path}/**/*{ext}", recursive=True)
    
    if len(files) > 0:
        print(f"Found {len(files)} files with extension {ext}")
        loader = SimpleDirectoryReader(
            input_dir=input_dir_path, required_exts=[ext], recursive=True
        )
        docs = loader.load_data()
        parser = (
            MarkdownNodeParser()
            if ext == ".md"
            else CodeSplitter.from_defaults(language=language)
        )
        nodes = parser.get_nodes_from_documents(docs)
        print(f"Processed {len(nodes)} nodes from {ext} files")
        return nodes
    return []

def setup_chat_engine(github_url, model_provider="OpenAI o3-mini"):
    """
    Set up the chat engine for a GitHub repository
    Args:
        github_url: URL of the GitHub repository
        model_provider: 'openai' or 'anthropic'
    """
    # Step 3: Process GitHub URL
    owner, repo = parse_github_url(github_url)
    if not owner or not repo:
        raise ValueError("Invalid GitHub URL")
    
    print(f"\nProcessing repository: {owner}/{repo}")
    input_dir_path = f"./{repo}"

    # Step 4: Clone repository if it doesn't exist
    if not os.path.exists(input_dir_path):
        print("\nCloning repository...")
        clone_repo(github_url)

    # Step 5: Define file types to process
    file_types = {
        ".md": "markdown",
        ".py": "python",
        ".ipynb": "python",
        ".js": "javascript",
        ".ts": "typescript"
    }

    # Step 6: Process all files
    print("\nProcessing files...")
    nodes = []
    for ext, language in file_types.items():
        nodes += parse_docs_by_file_types(ext, language, input_dir_path)

    if not nodes:
        raise ValueError("No files were processed from the repository")

    # Step 7: Setup embedding model
    print("\nSetting up embedding model...")
    # Settings.embed_model = FastEmbedEmbedding(model_name="BAAI/bge-base-en-v1.5")

    # Step 8: Create index
    print("Creating vector index...")
    index = VectorStoreIndex(nodes=nodes)

    # Step 9: Setup LLM and query engine
    if model_provider == "OpenAI o3-mini":
        Settings.llm = OpenAI(model="o3-mini")
    elif model_provider == "Claude 3.7 Sonnet":
        Settings.llm = Anthropic(model="claude-3-7-sonnet-20250219")
    elif model_provider == "Claude 3.5 Sonnet":
        Settings.llm = Anthropic(model="claude-3-5-sonnet-20240620")

    query_engine = index.as_query_engine(streaming=True, similarity_top_k=4)

    # Step 10: Setup custom prompt template
    qa_prompt_tmpl_str = (
        "Context information is below.\n"
        "---------------------\n"
        "{context_str}\n"
        "---------------------\n"
        "Given the context information above, you must always include a code snippet in your response.\n"
        "Think step by step to answer the query, and then provide a relevant code example that demonstrates the concept.\n"
        "Even if the question seems conceptual, translate your answer into a practical code example.\n"
        "If you don't know the answer, say 'I don't know!' but still provide a minimal code example of what you think might work.\n"
        "Query: {query_str}\n"
        "Answer: "
    )
    qa_prompt_tmpl = PromptTemplate(qa_prompt_tmpl_str)
    query_engine.update_prompts(
        {"response_synthesizer:text_qa_template": qa_prompt_tmpl}
    )

    print("\nChat engine setup complete! Ready for questions.")
    return query_engine
````

## Ячейка 6: code

````text

````

## Ячейка 7: code

````text
model_name = 'Claude 3.7 Sonnet'
github_url = "https://github.com/Lightning-AI/LitServe"
query_engine = setup_chat_engine(github_url, model_provider=model_name)
````

## Ячейка 8: code

````text
response = query_engine.query("What is this repo about?") 
print(response)
````

## Ячейка 9: markdown

# Evaluation

## Ячейка 10: code

````text
from opik import Opik

client = Opik()
dataset = client.get_or_create_dataset(name="Eval Code Generation")
````

## Ячейка 11: code

````text
from opik import track

@track
def my_llm_application(input: str) -> str:
    response = query_engine.query(input)
    return str(response)

def evaluation_task(x):
    return {
        "output": my_llm_application(x['input'])
    }
````

## Ячейка 12: code

````text
from opik.evaluation.metrics import base_metric, score_result
from openai import OpenAI
from typing import Any
import json

class LLMJudgeMetric(base_metric.BaseMetric):
    def __init__(self, name: str = "Code Quality Evaluation", model_name: str = "gpt-4o"):
        self.name = name
        self.llm_client = OpenAI()
        self.model_name = model_name
        self.prompt_template = """
        You are an expert judge tasked with evaluating the quality of code generation by comparing the AI-generated code to the ground truth code.
        
        Evaluate how well the AI-generated code matches the ground truth code in terms of:
        1. Correctness: Does the generated code implement the same functionality?
        2. Completeness: Does the generated code include all necessary components?
        3. Efficiency: Is the generated code similarly efficient in its approach?
        4. If the generated code is not exactly the same as the ground truth, but the functionality is similar, then still give a high score.
        5. Only focus on the code and the functionality, ignore the text.
        
        The format of your response should be a JSON object with no additional text or backticks that follows the format:
        {{
            "score": <score between 0 and 1>
        }}
        
        Where:
        - 0 means the generated code is completely different or incorrect
        - 1 means the generated code is functionally equivalent to the ground truth
        
        AI-generated code: {output}
        
        Response:
        """
    def score(self, output: str, **ignored_kwargs: Any):
        """
        Score the output of an LLM.

        Args:
            output: The output of an LLM to score.
            **ignored_kwargs: Any additional keyword arguments. This is important so that the metric can be used in the `evaluate` function.
        """
        # Construct the prompt based on the output of the LLM
        prompt = self.prompt_template.format(output=output)
        # Generate and parse the response from the LLM
        response = self.llm_client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}]
        )
        response_dict = json.loads(response.choices[0].message.content)

        response_score = float(response_dict["score"])

        return score_result.ScoreResult(
            name=self.name,
            value=response_score
        )
````

## Ячейка 13: code

````text
code_quality_metric = LLMJudgeMetric()

````

## Ячейка 14: code

````text
from opik.evaluation import evaluate

evaluation = evaluate(
    dataset=dataset,
    task=evaluation_task,
    experiment_name = model_name,
    scoring_metrics=[code_quality_metric],
    experiment_config={
        "model": "gpt-3.5-turbo"
    }
)
````

## Ячейка 15: code

````text

````