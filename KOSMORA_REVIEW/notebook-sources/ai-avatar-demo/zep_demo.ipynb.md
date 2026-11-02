# Исходные ячейки: ai-avatar-demo/zep_demo.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Zep Knowledge Graph + LLM Demo

This notebook demonstrates **Retrieval-Augmented Generation (RAG)** using:
- **Zep Cloud** for knowledge graph storage and semantic search
- **OpenRouter** + **Minimax M2** for generating intelligent, coherent responses

## What You'll Learn

1. **Ingest data** into Zep's Knowledge Graph as episodes
2. **Retrieve information** using semantic search
3. **Generate natural responses** using an LLM with retrieved context

This creates AI assistants that are both **knowledgeable** (grounded in your data) and **conversational** (natural to interact with).

## Ячейка 1: markdown

## Setup and Installation

First, we'll import the required libraries and set up our clients for both Zep and OpenRouter.

## Ячейка 2: code

````text
# Import required libraries
import os
from dotenv import load_dotenv
from zep_cloud.client import Zep
import time

# Import OpenAI client for OpenRouter (Minimax M2)
from openai import OpenAI

# Load environment variables from .env file
# This should contain your ZEP_API_KEY and OPENROUTER_API_KEY
load_dotenv()

# Get API keys from environment
ZEP_API_KEY = os.getenv("ZEP_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

if not ZEP_API_KEY:
    raise ValueError("ZEP_API_KEY not found in environment variables. Please add it to your .env file")

if not OPENROUTER_API_KEY:
    raise ValueError("OPENROUTER_API_KEY not found in environment variables. Please add it to your .env file")

print("Environment loaded successfully")
print(f"Zep API Key found: {ZEP_API_KEY[:5]}...")
print(f"OpenRouter API Key found: {OPENROUTER_API_KEY[:5]}...")
````

## Ячейка 3: markdown

## Initialize Zep Client

We create a Zep client instance that will handle all our interactions with the Zep API.

## Ячейка 4: code

````text
# Initialize the Zep client
# This is the main interface for all Zep operations
zep = Zep(api_key=ZEP_API_KEY)

# Initialize OpenRouter client for Minimax M2 LLM
# We'll use this to generate intelligent responses based on retrieved knowledge
openrouter_client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY
)

print("Zep client initialized successfully")
print("OpenRouter client initialized (Minimax M2 ready)")
````

## Ячейка 5: markdown

## Step 1: Create a Demo User

In Zep, all data is associated with a **User**. Let's create a demo user for this tutorial.

## Ячейка 6: code

````text
# Define a unique user ID for this demo
DEMO_USER_ID = "demo-user-coffee-shop"

# Try to create the user
# If the user already exists, Zep will return an error, which we'll catch
try:
    user = zep.user.add(
        user_id=DEMO_USER_ID,
        email="demo@coffeeshop.local",
        first_name="Demo",
        last_name="User"
    )
    print(f"User created: {user.user_id}")
    print(f"  Name: {user.first_name} {user.last_name}")
    print(f"  Email: {user.email}")
except Exception as e:
    # User likely already exists
    if "already exists" in str(e).lower() or "409" in str(e):
        print(f"User '{DEMO_USER_ID}' already exists (this is fine!)")
    else:
        print(f"Error creating user: {e}")
        print("Continuing anyway...")
````

## Ячейка 7: markdown

## Step 2: Prepare Demo Data

Let's create some sample text data about a fictional coffee shop. We'll store each piece of information as a separate **episode** in the knowledge graph.

In a real application, episodes could be:
- Chunks of documentation
- Customer interaction logs
- Product descriptions
- Research notes
- Any unstructured text data

## Ячейка 8: code

````text
# Define our demo episodes about a coffee shop
# Each episode is a paragraph of information that will be ingested into the knowledge graph
demo_episodes = [
    {
        "title": "Company Overview",
        "content": """Bean & Brew is a specialty coffee shop located in downtown Seattle, Washington. 
        Founded in 2018 by Maria Chen and David Rodriguez, the shop has become a local favorite for 
        artisanal coffee and pastries. The shop employs 12 staff members and serves approximately 
        300 customers daily. Bean & Brew is known for its sustainable sourcing practices and 
        community engagement initiatives."""
    },
    {
        "title": "Products and Services",
        "content": """Bean & Brew offers a wide range of beverages including espresso drinks, pour-over coffee, 
        cold brew, and specialty teas. The shop sources its coffee beans from small farms in Colombia, 
        Ethiopia, and Guatemala. In addition to beverages, they serve fresh-baked pastries, sandwiches, 
        and salads made daily by their in-house baker, Sophie Martin. The shop also sells whole bean 
        coffee and brewing equipment for home enthusiasts."""
    },
    {
        "title": "Operating Hours and Location",
        "content": """The coffee shop is located at 456 Pine Street, Seattle, WA 98101, right next to 
        Pioneer Square. Operating hours are Monday through Friday from 6:30 AM to 7:00 PM, Saturday 
        from 7:00 AM to 8:00 PM, and Sunday from 8:00 AM to 6:00 PM. The shop features free WiFi, 
        plenty of seating including outdoor patio space, and is wheelchair accessible. Parking is 
        available in the adjacent public parking garage."""
    },
    {
        "title": "Customer Loyalty Program",
        "content": """Bean & Brew launched its loyalty program, 'Bean Rewards', in January 2020. Members earn 
        1 point for every dollar spent, and 100 points can be redeemed for a free beverage of any size. 
        The program has over 2,500 active members. Premium members, who pay an annual fee of $50, receive 
        20% off all purchases and exclusive access to new menu items. The program is managed through a 
        mobile app available on iOS and Android."""
    },
    {
        "title": "Community Events",
        "content": """Bean & Brew hosts various community events throughout the year. Every first Saturday, 
        they organize 'Coffee Cupping Sessions' where customers can learn about different coffee origins 
        and brewing methods. The shop partners with local artists to display their work on the walls, 
        with exhibits changing monthly. During summer months, they host 'Music on the Patio' featuring 
        local musicians every Friday evening from 6 PM to 8 PM. All events are free and open to the public."""
    }
]

print(f"Prepared {len(demo_episodes)} episodes for ingestion")
print("\nEpisode titles:")
for i, episode in enumerate(demo_episodes, 1):
    print(f"  {i}. {episode['title']}")
````

## Ячейка 9: markdown

## Step 3: Ingest Episodes into Knowledge Graph

Now we'll add each episode to the user's knowledge graph. Zep will automatically:
- Extract entities (people, places, organizations, dates, etc.)
- Identify facts and relationships
- Build a searchable knowledge graph
- Enable semantic search over the content

Each call to `zep.graph.add()` creates an **episode** and returns a unique identifier.

## Ячейка 10: code

````text
# Store episode UUIDs for later reference
episode_uuids = []

print("Starting ingestion...\n")

# Iterate through each episode and add it to the knowledge graph
for i, episode in enumerate(demo_episodes, 1):
    print(f"[{i}/{len(demo_episodes)}] Ingesting: {episode['title']}")
    
    # Format the content with a header for better context
    formatted_content = f"# {episode['title']}\n\n{episode['content']}"
    
    try:
        # Add the episode to the user's knowledge graph
        # - user_id: The user this data belongs to
        # - type: The format of the data ('text', 'json', or 'message')
        # - data: The actual content to ingest
        result = zep.graph.add(
            user_id=DEMO_USER_ID,
            type="text",
            data=formatted_content
        )
        
        # Store the episode UUID for reference
        episode_uuids.append(result.uuid_)
        
        print(f"  Episode created: {result.uuid_}")
        print(f"  Content length: {len(formatted_content)} characters\n")
        
    except Exception as e:
        print(f"  Error ingesting episode: {e}\n")
    
    # Small delay to avoid rate limiting
    time.sleep(0.5)

print(f"\n{'='*60}")
print(f"Successfully ingested {len(episode_uuids)} episodes")
print(f"{'='*60}")
````

## Ячейка 11: markdown

## Step 4: Wait for Graph Processing

After ingestion, Zep processes the data in the background to build the knowledge graph. This typically takes a few seconds to a few minutes depending on the amount of data.

The graph extraction involves:
- Natural language understanding
- Entity extraction
- Building semantic embeddings for search
- etc.

Check the status of episodes on the Zep dashboard to see when processing is complete.

## Ячейка 12: markdown

## Step 5: Search the Knowledge Graph

Now that our data is ingested and processed, we can search the knowledge graph!

The `zep.graph.search()` method performs **semantic search**, meaning it understands the meaning of your query, not just keyword matching.

Let's try different queries to see what Zep has learned!

## Ячейка 13: markdown

### Ask Questions with AI-Generated Responses

## Ячейка 14: code

````text
def ask_with_knowledge(query: str, limit: int = 3) -> str:
    """
    Simple function to query the knowledge graph and use Minimax M2 to generate a coherent response.
    
    Args:
        query: The user's question (natural language)
        limit: Maximum number of results to retrieve
        
    Returns:
        A coherent response generated by the LLM based on retrieved knowledge
    """
    print(f"🔍 Query: '{query}'")
    print(f"   Retrieving from Zep (limit: {limit})...")
    
    try:
        # Step 1: Search the knowledge graph
        results = zep.graph.search(
            user_id=DEMO_USER_ID,
            query=query,
            scope="episodes",
            limit=limit
        )
        
        # Step 2: Extract relevant context from search results
        context_parts = []
                    
        if results.episodes:
            print(f"Found {len(results.episodes)} episodes")
            for episode in results.episodes:
                # Include the full episode content for better context
                context_parts.append(f"Document: {episode.content}")
        
        if not context_parts:
            return "I couldn't find any relevant information in the knowledge base to answer your question."
        
        # Step 3: Build context for the LLM
        retrieved_context = "\n\n".join(context_parts)
        
        # Step 4: Create a prompt that combines the query with retrieved context
        system_prompt = """You are a helpful AI assistant with access to a knowledge base about a coffee shop.
                            Your role is to answer questions accurately based on the provided context.

                            Guidelines:
                            - Answer naturally and conversationally
                            - Only use information from the provided context
                            - If the context doesn't contain enough information, say so honestly
                            - Be concise but informative
                            - Format your response in a friendly, helpful way"""

        user_message = f"""Context from knowledge base:
                        {retrieved_context}

                        User question: {query}

                        Please provide a clear, helpful answer based on the context above."""

        # Step 5: Call Minimax M2 via OpenRouter to generate response
        print("Generating response with Minimax M2...")
        
        response = openrouter_client.chat.completions.create(
            model="minimax/minimax-m2",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
            max_tokens=200
        )
        
        # Extract the generated response
        if response.choices and response.choices[0].message.content:
            answer = response.choices[0].message.content
            print("Response generated!\n")
            return answer
        else:
            return "Sorry, I couldn't generate a response."
            
    except Exception as e:
        print(f"Error: {e}")
        return f"An error occurred while processing your question: {str(e)}"
````

## Ячейка 15: markdown

### Example 1: Ask about the founders

## Ячейка 16: code

````text
# Ask about founders using LLM-powered response
response = ask_with_knowledge(
    query="Who founded Bean & Brew and when was it started?",
    limit=3
)

print("=" * 70)
print("AI RESPONSE:")
print("=" * 70)
print(response)
print("=" * 70)
````

## Ячейка 17: markdown

### Example 2: Ask about location and hours

## Ячейка 18: code

````text
# Get a comprehensive answer about location and hours
response = ask_with_knowledge(
    query="Where is Bean & Brew located and what are their hours?",
    limit=3
)

print("=" * 70)
print("AI RESPONSE:")
print("=" * 70)
print(response)
print("=" * 70)
````

## Ячейка 19: markdown

### Example 3: Ask about products and menu

## Ячейка 20: code

````text
# Ask about what's on the menu
response = ask_with_knowledge(
    query="What kinds of drinks and food can I get at Bean & Brew?",
    limit=3
)

print("=" * 70)
print("AI RESPONSE:")
print("=" * 70)
print(response)
print("=" * 70)
````

## Ячейка 21: markdown

## Summary

In this notebook, we demonstrated:

1. **Creating a Zep user** - Every piece of data in Zep belongs to a user

2. **Ingesting episodes** - We added 5 text episodes about a coffee shop to the knowledge graph

3. **RAG Pattern (Retrieval-Augmented Generation)** - The key workflow:
   - **Retrieve**: Search Zep's knowledge graph for relevant information
   - **Augment**: Add retrieved context to the LLM prompt
   - **Generate**: Use Minimax M2 to create coherent, natural responses

## Technical Stack

- **Zep Cloud** - Knowledge graph storage and semantic search
- **OpenRouter** - API gateway for accessing various LLMs
- **Minimax M2** - Advanced language model for generating responses
- **RAG Pattern** - Retrieval-Augmented Generation for accurate, context-aware AI

## Resources

- [Zep Documentation](https://help.getzep.com/)
- [Zep Python SDK](https://github.com/getzep/zep-python)
- [OpenRouter API](https://openrouter.ai/)
- [Minimax M2 Model](https://openrouter.ai/minimax/minimax-m2)

## Ячейка 22: markdown

