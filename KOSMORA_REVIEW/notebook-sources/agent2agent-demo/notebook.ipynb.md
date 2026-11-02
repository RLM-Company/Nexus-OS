# Исходные ячейки: agent2agent-demo/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
!curl -LsSf https://astral.sh/uv/install.sh | sh
!uv pip install python-a2a
````

## Ячейка 1: code

````text
# open a terminal and run: python agent1.py
# open another terminal and run: python agent2.py
# open another terminal and run: python agent3.py

# after that, run the following cells
````

## Ячейка 2: code

````text
from python_a2a import AgentNetwork, A2AClient, AIAgentRouter

# Create an agent network
network = AgentNetwork(name="Math Assistant Network")

# Add agents to the network
network.add("Sine", "http://localhost:4737")
network.add("Cosine", "http://localhost:4738")
network.add("Tangent", "http://localhost:4739")

# Create a router to intelligently direct queries to the best agent
router = AIAgentRouter(
    llm_client=A2AClient("http://localhost:5000/openai"),  # LLM for making routing decisions
    agent_network=network
)
````

## Ячейка 3: code

````text
# Route a query to the appropriate agent
query = "Tan of 0.78545"
agent_name, confidence = router.route_query(query)
print(f"Routing to {agent_name} with {confidence:.2f} confidence")

# Get the selected agent and ask the question
agent = network.get_agent(agent_name)
response = agent.ask(query)
print(f"Response: {response}")
````

## Ячейка 4: code

````text
# Route a query to the appropriate agent
query = "Sine of 3.14159"
agent_name, confidence = router.route_query(query)
print(f"Routing to {agent_name} with {confidence:.2f} confidence")

# Get the selected agent and ask the question
agent = network.get_agent(agent_name)
response = agent.ask(query)
print(f"Response: {response}")
````

## Ячейка 5: code

````text

````