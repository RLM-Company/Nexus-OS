# Исходные ячейки: sonnet4-vs-qwen3-coder/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import asyncio
import os
from typing import List, Dict, Any
from dotenv import load_dotenv
from code_ingestion import ingest_github_repo
from model_service import get_model_response_async
from code_evaluation import evaluate_code

load_dotenv()

async def get_full_response(model_name: str, prompt: str, context: Dict[str, Any]) -> str:
    """
    Get a complete response from a model (non-streaming)
    """
    response_text = ""
    async for chunk in get_model_response_async(model_name, prompt, context):
        response_text += chunk
    
    # Clean up the response by removing markdown code blocks
    cleaned_text = response_text.strip().removeprefix("```python").removeprefix("```").removesuffix("```").strip()
    return cleaned_text

async def process_single_query(query: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a single query and return results for both models
    """
    try:
        # Get responses from both models
        claude_response, qwen_response = await asyncio.gather(
            get_full_response("claude-4", query, context),
            get_full_response("qwen3-coder", query, context)
        )
        
        # Evaluate both responses
        claude_eval = evaluate_code(claude_response)
        qwen_eval = evaluate_code(qwen_response)
        
        # Return results in the specified format
        return {
            "query": query,
            "Correctness_Qwen": qwen_eval["detailed_metrics"]["correctness"]["score"],
            "Correctness_Sonnet": claude_eval["detailed_metrics"]["correctness"]["score"],
            "readability_Qwen": qwen_eval["detailed_metrics"]["readability"]["score"],
            "readability_Sonnet": claude_eval["detailed_metrics"]["readability"]["score"],
            "bestpractices_Qwen": qwen_eval["detailed_metrics"]["best_practices"]["score"],
            "bestpractices_Sonnet": claude_eval["detailed_metrics"]["best_practices"]["score"],
            # Additional fields for debugging/analysis
            "claude_response": claude_response,
            "qwen_response": qwen_response,
            "claude_overall_score": claude_eval["overall_score"],
            "qwen_overall_score": qwen_eval["overall_score"]
        }
        
    except Exception as e:
        print(f"Error processing query '{query}': {str(e)}")
        return {
            "query": query,
            "Correctness_Qwen": 0.0,
            "Correctness_Sonnet": 0.0,
            "readability_Qwen": 0.0,
            "readability_Sonnet": 0.0,
            "bestpractices_Qwen": 0.0,
            "bestpractices_Sonnet": 0.0,
            "error": str(e)
        }

async def process_queries(queries: List[str], github_repo_url: str) -> List[Dict[str, Any]]:
    """
    Process a list of queries against a GitHub repository
    
    Args:
        queries: List of query strings
        github_repo_url: URL of the GitHub repository to ingest
        
    Returns:
        List of dictionaries with evaluation results for each query
    """
    # Ingest the repository to get context
    print(f"Ingesting repository: {github_repo_url}")
    context = ingest_github_repo(github_repo_url)
    print("Repository ingested successfully!")
    
    # Process all queries
    results = []
    for i, query in enumerate(queries, 1):
        print(f"Processing query {i}/{len(queries)}: {query[:50]}...")
        result = await process_single_query(query, context)
        results.append(result)
        print(result)
        print(f"Completed query {i}/{len(queries)}")
    
    return results

def process_queries_sync(queries: List[str], github_repo_url: str) -> List[Dict[str, Any]]:
    """
    Synchronous wrapper for process_queries - works in Jupyter notebooks
    """
    try:
        # Try to get the current event loop
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If we're in a running event loop (like Jupyter), use asyncio.create_task
            import nest_asyncio
            nest_asyncio.apply()
            return loop.run_until_complete(process_queries(queries, github_repo_url))
        else:
            # If no event loop is running, use asyncio.run
            return asyncio.run(process_queries(queries, github_repo_url))
    except RuntimeError:
        # Fallback for Jupyter notebooks
        import nest_asyncio
        nest_asyncio.apply()
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(process_queries(queries, github_repo_url))

# Example usage:
if True:
    # Define your queries
    mcp_prompts = [
    "Build an MCP server that fetches the latest tweets from a user and sends them as a daily digest email via Gmail.",
    "Build an MCP server that creates a new Notion page when someone drops a file into a specific Google Drive folder.",
    "Create a small MCP server that listens for incoming questions from Discord and uses OpenAI to generate answers.",
    "Build an MCP server that watches a GitHub repo for new issues and posts them into a Telegram group.",
    "Write an MCP agent that reads a URL, extracts metadata with BeautifulSoup, and logs it to a CSV file.",
    "Create an MCP endpoint that receives a YouTube link, downloads the audio, and sends it via email.",
    "Create an MCP server that takes a PDF uploaded via a web form, summarizes it using an LLM, and returns the summary.",
    "Write an MCP-compatible server that pulls job listings from LinkedIn and posts them to a Slack channel every hour.",
    "Build a server that monitors a subreddit for new posts, filters them by keyword, and logs them in a Notion database.",
    "Create a minimal MCP server that extracts tabular data from a URL and sends it to an Airtable base."
]
    
    # Define the GitHub repository URL
    repo_url = "https://github.com/jlowin/fastmcp"
    
    # Process all queries
    results = process_queries_sync(mcp_prompts, repo_url)
    
    # Print results
    for result in results:
        print(f"\nQuery: {result['query']}")
        print(f"Qwen Correctness: {result['Correctness_Qwen']:.2f}")
        print(f"Sonnet Correctness: {result['Correctness_Sonnet']:.2f}")
        print(f"Qwen Readability: {result['readability_Qwen']:.2f}")
        print(f"Sonnet Readability: {result['readability_Sonnet']:.2f}")
        print(f"Qwen Best Practices: {result['bestpractices_Qwen']:.2f}")
        print(f"Sonnet Best Practices: {result['bestpractices_Sonnet']:.2f}")
        if 'error' in result:
            print(f"Error: {result['error']}")
````

## Ячейка 1: code

````text
import pandas as pd
import numpy as np
from typing import List, Dict, Any

def create_results_table(results: List[Dict[str, Any]]) -> pd.DataFrame:
    """
    Create a formatted table from evaluation results
    """
    # Create DataFrame from results
    df = pd.DataFrame(results)
    
    # Calculate overall scores (average of the three metrics)
    df['overall_score_qwen'] = (df['Correctness_Qwen'] + df['readability_Qwen'] + df['bestpractices_Qwen']) / 3
    df['overall_score_claude'] = (df['Correctness_Sonnet'] + df['readability_Sonnet'] + df['bestpractices_Sonnet']) / 3
    
    # Determine winner
    df['winner'] = df.apply(lambda row: 'Qwen' if row['overall_score_qwen'] > row['overall_score_claude'] else 'Claude', axis=1)
    
    # Round all numeric columns to 3 decimal places
    numeric_columns = [
        'Correctness_Qwen', 'readability_Qwen', 'bestpractices_Qwen',
        'Correctness_Sonnet', 'readability_Sonnet', 'bestpractices_Sonnet',
        'overall_score_qwen', 'overall_score_claude'
    ]
    
    for col in numeric_columns:
        if col in df.columns:
            df[col] = df[col].round(3)
    
    # Select and rename columns for the final table
    final_df = df[[
        'query',
        'Correctness_Qwen', 'readability_Qwen', 'bestpractices_Qwen',
        'Correctness_Sonnet', 'readability_Sonnet', 'bestpractices_Sonnet',
        'overall_score_qwen', 'overall_score_claude', 'winner'
    ]].copy()
    
    # Rename columns for better readability
    final_df.columns = [
        'Query',
        'Correctness (Qwen)', 'Readability (Qwen)', 'Best Practices (Qwen)',
        'Correctness (Claude)', 'Readability (Claude)', 'Best Practices (Claude)',
        'Overall Score (Qwen)', 'Overall Score (Claude)', 'Winner'
    ]
    
    return final_df

def display_results_table(results: List[Dict[str, Any]]):
    """
    Display the results table with formatting
    """
    df = create_results_table(results)
    
    # Display the table
    print("=== EVALUATION RESULTS TABLE ===")
    print(df.to_string(index=False))
    
    # Print summary statistics
    print("\n=== SUMMARY STATISTICS ===")
    print(f"Total queries: {len(df)}")
    print(f"Qwen wins: {len(df[df['Winner'] == 'Qwen'])}")
    print(f"Claude wins: {len(df[df['Winner'] == 'Claude'])}")
    
    # Average scores
    print(f"\nAverage Overall Scores:")
    print(f"Qwen: {df['Overall Score (Qwen)'].mean():.3f}")
    print(f"Claude: {df['Overall Score (Claude)'].mean():.3f}")
    
    return df

# If you want to display in Jupyter with better formatting:
def display_formatted_table(results: List[Dict[str, Any]]):
    """
    Display formatted table with styling (for Jupyter notebooks)
    """
    df = create_results_table(results)
    
    # Apply styling
    styled_df = df.style.set_properties(**{
        'background-color': 'lightblue',
        'color': 'black',
        'border-color': 'white',
        'border-style': 'solid',
        'border-width': '1px'
    }).format({
        'Correctness (Qwen)': '{:.3f}',
        'Readability (Qwen)': '{:.3f}',
        'Best Practices (Qwen)': '{:.3f}',
        'Correctness (Claude)': '{:.3f}',
        'Readability (Claude)': '{:.3f}',
        'Best Practices (Claude)': '{:.3f}',
        'Overall Score (Qwen)': '{:.3f}',
        'Overall Score (Claude)': '{:.3f}'
    }).apply(lambda x: ['background-color: lightgreen' if x['Winner'] == 'Qwen' else 'background-color: lightcoral' for i in range(len(x))], axis=1)
    
    return styled_df

styled_table = display_formatted_table(results)
styled_table
````