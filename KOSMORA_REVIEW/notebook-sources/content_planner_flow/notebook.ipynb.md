# Исходные ячейки: content_planner_flow/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Content Planning and Publishing Crew

## Ячейка 1: markdown

This notebook demonstrates how to create an AI crew for planning and publishing content using CrewAI Flows.
The crew will take a link to blog post, download content as markdown using firecrawl, analyze it and generate a twitter thread and schedule it on Typefully.

## Ячейка 2: markdown

### Initialization and Setup
Initial imports for the CrewAI Flow and Crew and setting up the environment

## Ячейка 3: code

````text
# Importing necessary libraries
import getpass
import os
import datetime
import uuid
import yaml
import json
import subprocess
from pathlib import Path
import pydantic
from pydantic import BaseModel
from typing import Optional

# Firecrawl SDK
from firecrawl import FirecrawlApp

# Typefully scheduler
import scheduler

# Importing Crew related components
from crewai import Agent, Task, Crew, LLM

# Importing CrewAI Flow related components
from crewai.flow.flow import Flow, listen, start, router, or_

from dotenv import load_dotenv
load_dotenv()
# Apply a patch to allow nested asyncio loops in Jupyter
import nest_asyncio
nest_asyncio.apply()
````

## Ячейка 4: markdown

## Setup LLM

Make sure you have ollama installed and running on your machine

## Ячейка 5: code

````text
llm = LLM(
    model="ollama/llama3.2",
    base_url="http://localhost:11434"
)
````

## Ячейка 6: markdown

# Blog Post URL

## Ячейка 7: code

````text
blog_post_url = "https://blog.dailydoseofds.com/p/5-chunking-strategies-for-rag"
````

## Ячейка 8: markdown

## Plan for our Flow

1. Scrape the blog post
2. Decode where to post using a router
3. Kickoff the right **[Crew of Agents]** to prepare a draft ready to publish
4. Publish it using typefully

## Ячейка 9: code

````text
from IPython.display import HTML
HTML('<img src="content_writing_flow.png" width="1000" height="750"/>')
````

## Ячейка 10: markdown

# Twitter Thread Planning Crew

This structure will be used to capture the output of the planning crew which will be used to create the twitter thread and schedule it on Typefully.

## Ячейка 11: code

````text
class Tweet(BaseModel):
    """Represents an individual tweet in a thread"""
    content: str
    is_hook: bool = False  # Identifies if this is the opening/hook tweet
    media_urls: Optional[list[str]] = []  # Optional media attachments (images, code snippets)

class Thread(BaseModel):
    """Represents a Twitter thread"""
    topic: str  # Main topic/subject of the thread
    tweets: list[Tweet]  # List of tweets in the thread
````

## Ячейка 12: code

````text
from crewai_tools import (
    DirectoryReadTool,
    FileReadTool,
)

# Load agent and task configurations from YAML files
with open('config/planner_agents.yaml', 'r') as f:
    agents_config = yaml.safe_load(f)

with open('config/planner_tasks.yaml', 'r') as f:
    tasks_config = yaml.safe_load(f)
````

## Ячейка 13: code

````text
draft_analyzer = Agent(config=agents_config['draft_analyzer'], tools=[
    DirectoryReadTool(),
    FileReadTool()
], llm=llm)
twitter_thread_planner = Agent(config=agents_config['twitter_thread_planner'], tools=[
    DirectoryReadTool(),
    FileReadTool()
], llm=llm)

analyze_draft = Task(
  config=tasks_config['analyze_draft'],
  agent=draft_analyzer
)
create_twitter_thread_plan = Task(
  config=tasks_config['create_twitter_thread_plan'],
  agent=twitter_thread_planner,
  output_pydantic=Thread
)

planning_crew = Crew(
    agents=[draft_analyzer, twitter_thread_planner],
    tasks=[analyze_draft, create_twitter_thread_plan],
    verbose=False
)
````

## Ячейка 14: markdown

# LinkedIn Post Planning Crew

## Ячейка 15: code

````text
class LinkedInPost(BaseModel):
    """Represents a LinkedIn post"""
    content: str
    media_url: str # Main image url for the post
````

## Ячейка 16: code

````text
linkedin_post_planner = Agent(config=agents_config['linkedin_post_planner'], llm=llm)

create_linkedin_post_plan = Task(
  config=tasks_config['create_linkedin_post_plan'],
  agent=linkedin_post_planner,
  output_pydantic=LinkedInPost
)

linkedin_planning_crew = Crew(
    agents=[draft_analyzer, linkedin_post_planner],
    tasks=[analyze_draft, create_linkedin_post_plan],
    verbose=False
)
````

## Ячейка 17: markdown

# Create Content Planning Flow

A Flow to create the content planning for twitter and linkedin using separate crews for twitter and linkedin

## Ячейка 18: code

````text
from IPython.display import HTML
HTML('<img src="content_writing_flow.png" width="1000" height="750"/>')
````

## Ячейка 19: code

````text
from crewai.flow.flow import Flow, listen, start, router, or_

class ContentPlanningState(BaseModel):
  """
  State for the content planning flow
  """
  blog_post_url: str = blog_post_url
  draft_path: Path = "workdir/"
  post_type: str = "twitter"
  path_to_example_threads: str = "workdir/example_threads.txt"

class CreateContentPlanningFlow(Flow[ContentPlanningState]):
  # Scrape the blog post  
  # No need for AI Agents on this step, so we just use regular Python code
  @start()
  def scrape_blog_post(self):
    print(f"# fetching draft from: {self.state.blog_post_url}")
    app = FirecrawlApp(api_key=os.getenv("FIRECRAWL_API_KEY"))
    scrape_result = app.scrape_url(self.state.blog_post_url, params={'formats': ['markdown', 'html']})
    try:
      title = scrape_result['metadata']['title']
    except Exception as e:
      title = str(uuid.uuid4())
    self.state.draft_path = f'workdir/{title}.md'
    with open(self.state.draft_path, 'w') as f:
      f.write(scrape_result['markdown'])
    return self.state

  @router(scrape_blog_post)
  def select_platform(self):
    if self.state.post_type == "twitter":
      return "twitter"
    elif self.state.post_type == "linkedin":
      return "linkedin"

  @listen("twitter")
  def twitter_draft(self):
    print(f"# Planning content for: {self.state.draft_path}")
    result = planning_crew.kickoff(inputs={'draft_path': self.state.draft_path, 'path_to_example_threads': self.state.path_to_example_threads})
    print(f"# Planned content for {self.state.draft_path}:")
    for tweet in result.pydantic.tweets:
        print(f"    - {tweet.content}")
    return result
  
  @listen("linkedin")
  def linkedin_draft(self):
    print(f"# Planning content for: {self.state.draft_path}")
    result = linkedin_planning_crew.kickoff(inputs={'draft_path': self.state.draft_path})
    print(f"# Planned content for {self.state.draft_path}:")
    print(f"    - {result.pydantic.content}")
    return result

  @listen(or_(twitter_draft, linkedin_draft))
  def save_plan(self, plan):
    with open(f'thread/{self.state.draft_path.split("/")[-1]}_{self.state.post_type}.json', 'w') as f:
        json.dump(plan.pydantic.model_dump(), f, indent=2)

  @listen(or_(twitter_draft, linkedin_draft))
  def publish(self, plan):
    print(f"# Publishing thread for: {self.state.draft_path}")
    ## Schedule for 1 hour from now    
    response = scheduler.schedule(
        thread_model=plan,
        post_type=self.state.post_type
    )
    print(f"# Thread scheduled for: {self.state.draft_path}")
    print(f"Here's the link to scheduled draft: {response['share_url']}")


````

## Ячейка 20: markdown

Implementing helper methods to plot and execute the flow in a Jupyter notebook

## Ячейка 21: code

````text
# Plot the flow
flow = CreateContentPlanningFlow()
flow.plot()

# Display the flow visualization using IFrame
from IPython.display import IFrame

# Display the flow visualization
# IFrame(src='./crewai_flow.html', width='100%', height=400)
````

## Ячейка 22: code

````text
post_type = "twitter"
flow = CreateContentPlanningFlow()
flow.state.post_type = post_type
flow.state
````

## Ячейка 23: code

````text

flow.kickoff()
````

## Ячейка 24: code

````text
flow = CreateContentPlanningFlow()

````

## Ячейка 25: code

````text

````

## Ячейка 26: code

````text
flow.state
````

## Ячейка 27: code

````text

````