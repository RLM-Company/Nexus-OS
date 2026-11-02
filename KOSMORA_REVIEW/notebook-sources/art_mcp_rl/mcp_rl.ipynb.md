# Исходные ячейки: art_mcp_rl/mcp_rl.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import os
import unsloth

os.environ["UNSLOTH_FORCE_FLOAT16"] = "1"
````

## Ячейка 1: markdown

To teach a model to use your MCP server, click **Runtime** > **Run all**. Make sure you've enabled a free Tesla T4 GPU and edit the [configuration](#configuration) cell below!

<div class="align-center">
<a href="https://github.com/openpipe/art"><img src="https://github.com/openpipe/art/raw/main/assets/ART_pill.png" height="50"></a>
<a href="https://discord.gg/zbBHRUpwf4"><img src="https://github.com/openpipe/art/raw/main/assets/Discord.png" height="50"></a>
<a href="https://art.openpipe.ai"><img src="https://github.com/openpipe/art/raw/main/assets/Documentation_pill.png" height="50"></a>

Questions? Join the Discord and ask away! For feature requests or to leave a star, visit our [GitHub](https://github.com/openpipe/art).

</div>

<a href="https://art.openpipe.ai/"><img src="https://github.com/openpipe/art/raw/main/assets/Header_separator.png" height="5"></a>

**MCP•RL: Teach you agent how to use any MCP server**

This notebook shows how to train a Qwen 2.5 3B model to effectively use any MCP server. Simply provide an MCP server url and the notebook will:

1. Query the server's tools
2. Generate a set of input tasks that use those tools
3. Train the model on those tasks using automatic RULER evaluation
4. Test the trained model by giving it new tasks to complete

RULER judges response quality purely from the agent's final output - no labeled data required!

*Note: In this notebook we use local MCP servers, but the technique below applies to all MCP servers!*


## Ячейка 2: code

````text
# @title 💿 Installation
# Portions adapted from Unsloth Notebooks (https://github.com/unslothai/notebooks)
# Copyright (c) Unsloth contributors.
# License: GNU LGPL v3.0.
# Modifications by OpenPipe:
# - switched to uv
# - changed vllm/triton pinning logic
# - added protobuf pins
# - adjusted syntax for pushing to HF
# See /licenses/LGPL-3.0.txt and /licenses/GPL-3.0.txt for full text.

import os

if "COLAB_" not in "".join(os.environ.keys()):
    !uv pip install "openpipe-art[backend]==0.5.9" tenacity "mcp>=1.11.0" "gql<4" aiohttp --prerelease allow --no-cache-dir
else:
    try:
        import numpy

        get_numpy = f"numpy=={numpy.__version__}"
    except:
        get_numpy = "numpy"
    try:
        import subprocess

        is_t4 = "Tesla T4" in str(subprocess.check_output(["nvidia-smi"]))
    except:
        is_t4 = False
    get_vllm, get_triton = (
        ("vllm==0.9.2", "triton==3.2.0") if is_t4 else ("vllm", "triton")
    )
    !uv pip install --upgrade \
        openpipe-art[backend]==0.4.11 tenacity pillow==11.3.0 protobuf==5.29.5 {get_vllm} {get_numpy} --prerelease allow --no-cache-dir
    !uv pip install -qqq {get_triton}
````

## Ячейка 3: markdown

## MCP server 

## Ячейка 4: code

````text
!uv pip install fastmcp --quiet
````

## Ячейка 5: code

````text
import subprocess
subprocess.Popen(["python", "mcp_server.py"])
````

## Ячейка 6: markdown

<a name="configuration"></a>

### 🎯 Configuration - Edit These Settings

Add an OpenRouter API key and MCP server url below.

## Ячейка 7: code

````text
# Required - Used for generating training inputs and RULER evaluation
OPENROUTER_API_KEY = ""  # Put your OpenRouter key here

# 🔌 Point to any  MCP server
MCP_SERVER_URL = "http://0.0.0.0:8903/mcp"

# Optional - Enables metric logging
WANDB_API_KEY = ""

# Choose the base model to train
BASE_MODEL = "Qwen/Qwen2.5-3B-Instruct"  # Options: "Qwen/Qwen2.5-3B-Instruct", "Qwen/Qwen2.5-7B-Instruct", etc.
````

## Ячейка 8: code

````text
# @title Advanced Settings

# Model configuration
MODEL_NAME = "sql-agent-3b"  # Name for your trained model
PROJECT_NAME = "mcp-rl"  # Project name for tracking

# Training configuration
TRAINING_CONFIG = {
    "num_training_inputs": 16,  # Number of training inputs to generate
    "groups_per_step": 2,  # Inputs to process per training step
    "num_epochs": 1,  # Number of times through all data
    "rollouts_per_group": 4,  # Different responses per input (for RULER comparison)
    "learning_rate": 1e-5,  # Learning rate
    "max_training_steps": None,  # Maximum training steps (set to None for no limit)
}

MAX_TURNS = 10  # Maximum number of turns for the model to generate during one rollout

NUM_TEST_INPUTS = 8  # Number of test inputs to generate
RULER_MODEL = "openrouter/openai/gpt-4o-mini"  # Model for RULER evaluation
INPUT_GENERATION_MODEL = "openai/gpt-5-nano"

# Colab/T4 specific config to avoid OOM errors
MAX_TURNS = 3  # Decrease the number of turns to avoid OOM errors on a T4
MAX_SEQ_LENGTH = 16384  # Maximum sequence length
GPU_MEMORY_UTILIZATION = 0.8  # GPU memory usage (0.0-1.0)
````

## Ячейка 9: code

````text
# @title Debug utilities

import json
import time
import traceback
from typing import Any

DEBUG_LOG = True  # flip to False to silence logs
LOG_JSON_MAX = 2000  # cap large JSON prints


def _ts() -> str:
    return time.strftime("%H:%M:%S")


def log(msg: str, **kv):
    if not DEBUG_LOG:
        return
    parts = [f"[{_ts()}] {msg}"]
    if kv:
        kv_str = " ".join(f"{k}={repr(v)}" for k, v in kv.items())
        parts.append("| " + kv_str)
    print(" ".join(parts))


def log_json(title: str, payload: Any, max_len: int = LOG_JSON_MAX):
    if not DEBUG_LOG:
        return
    try:
        s = json.dumps(payload, indent=2, default=str)
    except Exception:
        s = str(payload)
    if len(s) > max_len:
        s = s[:max_len] + "\n... (truncated)"
    print(f"[{_ts()}] {title}:\n{s}")
````

## Ячейка 10: code

````text
# @title 🔌 MCP helpers

from contextlib import asynccontextmanager

import mcp.types as types
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client


@asynccontextmanager
async def mcp_session():
    """
    Connects to the remote Smithery MCP server using the full URL that includes
    your API key & profile. No OAuth provider is used.
    """
    async with streamable_http_client(MCP_SERVER_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def list_tools_and_resources():
    """Return (tools_result, resources_result) from the remote Smithery server."""
    async with mcp_session() as session:
        tools = await session.list_tools()
        try:
            resources = await session.list_resources()
        except Exception:
            # Some servers don't implement resources; keep interface stable
            class _Empty:
                resources = []

            resources = _Empty()
        return tools, resources


async def call_mcp_tool(tool_name: str, arguments: dict):
    """Invoke a tool on the remote Smithery server and return the CallToolResult."""
    async with mcp_session() as session:
        return await session.call_tool(tool_name, arguments)


tools, resources = await list_tools_and_resources()
print("Tools:", [t.name for t in tools.tools])
print(
    "Resources:",
    [getattr(r, "uri", None) for r in getattr(resources, "resources", []) or []],
)
````

## Ячейка 11: code

````text
!nvidia-smi
````

## Ячейка 12: code

````text
def get_content_text(result) -> str:
    # Extract text content from tool call result per MCP content schema
    if isinstance(result, str):
        return result
    if hasattr(result, "content") and result.content:
        out = ""
        for item in result.content:
            if isinstance(item, types.TextContent):
                out += item.text
            else:
                out += str(item)
        return out
    if hasattr(result, "structured") and result.structured is not None:
        try:
            return json.dumps(result.structured)
        except Exception:
            return str(result.structured)
    return str(result)
````

## Ячейка 13: code

````text
# @title Let's generate our train and validation scenarios!

import os
import random

from dotenv import load_dotenv

# Import the generate_scenarios function from art.mcp and logging utilities
from art.mcp import generate_scenarios
from art.mcp.generate_scenarios import preview_scenarios
from art.utils.logging import info, ok, step, warn, err

load_dotenv()

# required env/key check
# If OPENROUTER_API_KEY exists as a var, use it; otherwise pull from env
_openrouter_key = os.getenv("OPENROUTER_API_KEY")
try:
    _openrouter_key = _openrouter_key if _openrouter_key else OPENROUTER_API_KEY  # noqa: F821 (defined upstream in your notebook)
except NameError:
    pass

if _openrouter_key:
    os.environ["OPENROUTER_API_KEY"] = _openrouter_key
    ok("OPENROUTER_API_KEY found.")
else:
    err("OPENROUTER_API_KEY is required for data generation and RULER evaluation.")
    raise ValueError(
        "OPENROUTER_API_KEY is required for data generation and RULER evaluation."
    )

# Convert MCP tools and resources to the expected format
tools_result, resources_result = await list_tools_and_resources()

# Convert tools to the format expected by generate_scenarios
tools_list = []
for tool in tools_result.tools or []:
    tools_list.append({
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.inputSchema,
    })

# Convert resources to the format expected by generate_scenarios
resources_list = []
for resource in getattr(resources_result, "resources", []) or []:
    resources_list.append({
        "uri": str(resource.uri),
        "name": resource.name,
        "description": resource.description,
        "mimeType": resource.mimeType,
    })

# First, get the actual schema from your database
schema_info = ""
for table in ["departments", "employees", "projects"]:
    result = await call_mcp_tool("describe_table", {"table_name": table})
    schema_info += f"\nTable '{table}': {get_content_text(result)}"

# Sample a few rows so the generator knows what kind of data exists
for table in ["departments", "employees", "projects"]:
    result = await call_mcp_tool("run_query", {"sql": f"SELECT * FROM {table} LIMIT 3"})
    schema_info += f"\nSample data from '{table}': {get_content_text(result)}"

# Now enrich the tool descriptions with this context
enriched_tools_list = []
for tool in tools_list:
    enriched = tool.copy()
    if tool["name"] == "run_query":
        enriched["description"] = (
            tool["description"] +
            f"\n\nAvailable database schema:{schema_info}"
        )
    enriched_tools_list.append(enriched)


# Calculate total scenarios needed
try:
    expected_total = TRAINING_CONFIG["num_training_inputs"] + NUM_TEST_INPUTS  # noqa: F821
except NameError:
    err("TRAINING_CONFIG/NUM_TEST_INPUTS not defined in this notebook.")
    raise

info(f"Target total scenarios: {expected_total}")

# Generate scenarios using the art.mcp function
max_attempts = 10
scenarios = None

for attempt in range(1, max_attempts + 1):
    step(f"Attempt {attempt}/{max_attempts} ...")
    t_attempt = time.perf_counter()
    try:
        scenario_collection = await generate_scenarios(
            tools=enriched_tools_list,
            resources=resources_list,
            num_scenarios=expected_total,
            show_preview=False,  # We'll preview separately for train/val
            generator_model=INPUT_GENERATION_MODEL,
            generator_api_key=_openrouter_key,
        )
        # Convert GeneratedScenarioCollection to list of dicts for compatibility
        scenarios = [{"task": s.task, "difficulty": s.difficulty} for s in scenario_collection.scenarios]
        ok(f"Attempt {attempt} succeeded in {time.perf_counter() - t_attempt:.2f}s.")
        break
    except Exception as e:
        warn(f"Attempt {attempt} failed: {e}")
        if attempt < max_attempts:
            time.sleep(min(1.5 * attempt, 6.0))
        else:
            err("All attempts exhausted.")
            raise

# Split into train/val
ok(f"Generated {len(scenarios)} scenarios total.")
step("Shuffling scenarios and splitting into train/val ...")
random.shuffle(scenarios)

train_n = TRAINING_CONFIG["num_training_inputs"]  # noqa: F821
raw_train_scenarios = scenarios[:train_n]
raw_val_scenarios = scenarios[train_n:]

ok(f"Train: {len(raw_train_scenarios)} | Val: {len(raw_val_scenarios)}")

info("Sample (train) preview:")
preview_scenarios(raw_train_scenarios, n=min(5, len(raw_train_scenarios)))

info("Sample (val) preview:")
preview_scenarios(raw_val_scenarios, n=min(5, len(raw_val_scenarios)))

ok("Done.")
````

## Ячейка 14: code

````text
raw_train_scenarios
````

## Ячейка 15: code

````text
raw_val_scenarios
````

## Ячейка 16: markdown

## Register model with the server

## Ячейка 17: code

````text
# @title Run this cell to train your model!

import os
import random
from dataclasses import dataclass

import weave
from dotenv import load_dotenv
from openai import AsyncOpenAI

import art
from art.local import LocalBackend
from art.rewards import ruler_score_group
from art.utils import iterate_dataset

load_dotenv()

# Optional
if WANDB_API_KEY:
    os.environ["WANDB_API_KEY"] = WANDB_API_KEY
    weave.init(PROJECT_NAME)
else:
    print("WANDB_API_KEY is not set. We'll skip logging metrics to Weights & Biases.")

random.seed(42)

# Declare the model
model = art.TrainableModel(
    name=MODEL_NAME,
    project=PROJECT_NAME,
    base_model=BASE_MODEL,
)

# Clear GPU memory before registering
import torch, gc
gc.collect()
torch.cuda.empty_cache()

# To run on a T4, we need to override some config defaults.
model._internal_config = art.dev.InternalModelConfig(
    init_args=art.dev.InitArgs(
        max_seq_length=MAX_SEQ_LENGTH,
        dtype="float16",
    ),
    engine_args=art.dev.EngineArgs(
        enforce_eager=True,
        gpu_memory_utilization=0.80,
    ),
)

# Initialize the server
backend = LocalBackend(
    in_process=True,
    path="./.art",
)

# Register the model with the local Backend
await model.register(backend)

print("Model created!")
print("Base model:", BASE_MODEL)
print("Model name:", MODEL_NAME)
print("Project name:", PROJECT_NAME)
````

## Ячейка 18: markdown

## RULER in action

## Ячейка 19: code

````text
import art
from art.rewards import ruler_score_group

base_messages = [
    {"role": "system", "content": "You count numbers using numeric symbols."},
    {"role": "user", "content": "Count to 10."},
]

good_trajectory = art.Trajectory(
    messages_and_choices=[
        *base_messages,
        {"role": "assistant", "content": "1, 2, 3, 4, 5, 6, 7, 8, 9, 10"},
    ],
    reward=0,
)

mediocre_trajectory = art.Trajectory(
    messages_and_choices=[
        *base_messages,
        {"role": "assistant",
         "content": "one, two, three, four, five, six, seven, eight, nine, ten"},
    ],
    reward=0,
)

bad_trajectory = art.Trajectory(
    messages_and_choices=[
        *base_messages,
        {"role": "assistant", "content": "a, b, c, d, e, f, g, h, i, j"},
    ],
    reward=0,
)

sample_group = art.TrajectoryGroup(
    trajectories=[good_trajectory, mediocre_trajectory, bad_trajectory]
)

judged_group = await ruler_score_group(
    sample_group, "openrouter/openai/gpt-4o-mini", debug=True
)
````

## Ячейка 20: markdown

## Define rollout function

## Ячейка 21: code

````text
@dataclass
class McpScenario:
    """A scenario for MCP agent evaluation against a remote Smithery server."""

    task_description: str
    max_turns: int = MAX_TURNS


@weave.op()
async def rollout(
    model: art.Model,
    scenario: McpScenario,
    debug: bool = False,
) -> art.Trajectory:
    """Run an MCP agent rollout against the remote Smithery MCP server."""
    traj = art.Trajectory(
        messages_and_choices=[],
        reward=0,
        metadata={"task": scenario.task_description},
        metrics={
            "task_completed": False,
            "success": False,
            "ran_out_of_turns": False,
        },
        scenario=scenario,
    )

    # Discover available tools from the remote server
    tools_result, _resources_result = await list_tools_and_resources()
    tool_names = [t.name for t in tools_result.tools]
    log("rollout: discovered tools", count=len(tool_names), names=tool_names)

    # Convert to OpenAI tool format
    tool_schemas = []
    for tool in tools_result.tools:
        tool_schema = {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or f"MCP tool: {tool.name}",
                "parameters": tool.inputSchema or {"type": "object", "properties": {}},
            },
        }
        tool_schemas.append(tool_schema)

    # Add completion tool schema
    tool_schemas.append(
        {
            "type": "function",
            "function": {
                "name": "complete_task",
                "description": "Complete the task with a summary",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Summary of accomplishments",
                        }
                    },
                    "required": ["summary"],
                },
            },
        }
    )

    traj.tools = tool_schemas

    # Initialize conversation
    system_prompt = (
        f"You are a database agent with access to a live SQL database. "
        f"The database is working correctly. DO NOT claim there are errors "
        f"unless a tool explicitly returns an error message. "
        f"ALWAYS use tools to answer questions — never simulate or guess. "
        f"Start by calling list_tables, then describe_table, then run_query. "
        f"Call 'complete_task' with your answer when done. "
        f"You have {scenario.max_turns} turns."
    )

    traj.messages_and_choices = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": f"Please complete this task: {scenario.task_description}",
        },
    ]

    num_turns = 0
    task_completed = False

    # Main interaction loop
    while num_turns < scenario.max_turns and not task_completed:
        num_turns += 1

        try:
            # === Log request ===
            last_user = next(
                (m for m in reversed(traj.messages()) if m["role"] == "user"), None
            )
            log(
                "LLM request",
                step=num_turns,
                model=(model.inference_model_name or model.name),
                tools=len(tool_schemas),
                last_user=(last_user["content"][:160] + "..." if last_user else None),
            )

            # Get LLM response
            async with traj.track_duration("llm_completion"):
                openai_client = AsyncOpenAI(
                    api_key=model.inference_api_key,
                    base_url=model.inference_base_url,
                )

                # We also log the request body (without huge params)
                req_preview = {
                    "model": model.inference_model_name
                    if model.inference_model_name
                    else model.name,
                    "messages_len": len(traj.messages()),
                    "tools_len": len(tool_schemas),
                }
                log_json("LLM request (preview)", req_preview)

                response = await openai_client.chat.completions.create(
                    model=model.inference_model_name
                    if model.inference_model_name
                    else model.name,
                    messages=traj.messages(),
                    tools=tool_schemas,
                    max_completion_tokens=8000,
                )

            # === Log response ===
            choice = response.choices[0]

            finish_reason = getattr(choice, "finish_reason", None)
            msg = choice.message
            has_tools = bool(getattr(msg, "tool_calls", None))
            content_preview = (
                (msg.content[:200] + "...")
                if isinstance(msg.content, str) and msg.content
                else str(msg.content)[:200]
            )
            log(
                "LLM response parsed",
                finish_reason=finish_reason,
                has_tool_calls=has_tools,
                content_preview=content_preview,
            )

            traj.messages_and_choices.append(choice)

            # Handle tool calls
            if msg.tool_calls:
                for tool_call in msg.tool_calls:
                    try:
                        log(
                            "Tool call received",
                            name=tool_call.function.name,
                            raw_args=tool_call.function.arguments,
                        )
                        tool_args = json.loads(tool_call.function.arguments or "{}")

                        if tool_call.function.name == "complete_task":
                            traj.metrics["task_completed"] = True
                            task_completed = True
                            traj.logs.append(
                                f"Task completion attempted with summary: {tool_args.get('summary', '')}"
                            )
                            # We still append a tool message for completeness
                            traj.messages_and_choices.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tool_call.id,
                                    "content": "Task marked complete.",
                                }
                            )
                        else:
                            # 🔧 Call MCP tool through remote Smithery session
                            result = await call_mcp_tool(
                                tool_call.function.name, tool_args
                            )

                            content_text = get_content_text(result)
                            log(
                                "Tool result",
                                name=tool_call.function.name,
                                len=len(content_text),
                            )

                            if len(content_text) > 20000:
                                # print(
                                #     f"Tool call result for {tool_call.function.name} is too long: {len(content_text)}"
                                # )
                                # print(f"Args: {tool_args}")
                                # print(content_text[:1000])
                                # print(content_text[-1000:])
                                raise Exception(
                                    f"Tool call result for {tool_call.function.name} is too long: {len(content_text)}"
                                )

                            # Add tool response
                            traj.messages_and_choices.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": tool_call.id,
                                    "content": content_text,
                                }
                            )

                    except Exception as e:
                        traceback.print_exc()
                        traj.logs.append(f"Tool call error: {e}")

                        # Add error response
                        traj.messages_and_choices.append(
                            {
                                "role": "tool",
                                "tool_call_id": tool_call.id,
                                "content": f"Error: {str(e)}",
                            }
                        )
            else:
                # No tool calls — log and continue (RULER will likely give 0)
                log(
                    "LLM returned no tool_calls; skipping tool execution",
                    turn=num_turns,
                )
                # You can consider breaking here or letting it try another turn
                # break

        except Exception as e:
            traceback.print_exc()
            traj.logs.append(f"Error in turn {num_turns}: {e}")
            break

    if not task_completed and num_turns == scenario.max_turns:
        traj.metrics["ran_out_of_turns"] = True

    traj.metrics["num_turns"] = num_turns

    return traj.finish()
````

## Ячейка 22: markdown

## Training pipeline

## Ячейка 23: code

````text
# =============== Training code ===============

print(
    f"Using config: max_turns={MAX_TURNS}, rollouts_per_group={TRAINING_CONFIG['rollouts_per_group']}, "
    f"groups_per_step={TRAINING_CONFIG['groups_per_step']}, num_epochs={TRAINING_CONFIG['num_epochs']}, "
    f"learning_rate={TRAINING_CONFIG['learning_rate']}"
)

await model.register(backend)

train_scenarios = [
    McpScenario(
        task_description=scenario["task"],
        max_turns=MAX_TURNS,
    )
    for scenario in raw_train_scenarios
]

# Create dataset iterator using raw scenarios
train_iterator = iterate_dataset(
    train_scenarios,
    groups_per_step=TRAINING_CONFIG["groups_per_step"],
    num_epochs=TRAINING_CONFIG["num_epochs"],
    initial_step=await model.get_step(),  # Resume from checkpoint
)

# Main training loop using iterate_dataset
for batch in train_iterator:
    print("Gathering trajectory groups with RULER scoring...")

    # Use gather_trajectory_groups with ruler_score_group
    groups = await art.gather_trajectory_groups(
        (
            art.TrajectoryGroup(
                rollout(model, scenario, False)
                for _ in range(TRAINING_CONFIG["rollouts_per_group"])
            )
            for scenario in batch.items
        ),
        pbar_desc=f"train gather step {batch.step}",
    )

    scored_groups = []
    for group in groups:
        # Use RULER to assign relative scores to each trajectory
        judged_group = await ruler_score_group(
            group, judge_model=RULER_MODEL, debug=True, swallow_exceptions=True
        )
        scored_groups.append(judged_group)

    print("starting train")
    await model.train(
        scored_groups,
        config=art.TrainConfig(learning_rate=TRAINING_CONFIG["learning_rate"]),
    )
````

## Ячейка 24: markdown

## Test your model

## Ячейка 25: code

````text
# @title Test Your Model!

# Generate test inputs
print("Generating test inputs...")
val_scenarios = [
    McpScenario(
        task_description=scenario["task"],
        max_turns=MAX_TURNS,
    )
    for scenario in raw_val_scenarios
]

print(f"\n🧪 Testing the trained model on {len(val_scenarios)} new inputs:\n")
print("=" * 80)

for i, scenario in enumerate(val_scenarios):
    print(f"\nTest {i + 1}:")
    print(f"Input: {scenario.task_description}")

    # Run the model
    result_trajectory = await rollout(model, scenario)

    # Extract the model's response
    messages = result_trajectory.messages()
    model_response = messages[-1]["content"] if messages else "No response"

    print(f"Model output: {model_response}")
    print("-" * 80)

print("\n🎉 Testing completed!")
print(
    f"\nYour model '{MODEL_NAME}' has been trained to use the MCP server at:"
)
print(MCP_SERVER_URL)
print("\nTo use this model in production:")
print("1. The model checkpoint is saved in ./.art/")
print("2. You can load it using the vLLM library")
print(
    "3. Or continue training with more examples by adjusting the configuration at the top"
)
````

## Ячейка 26: code

````text
raw_val_scenarios
````

## Ячейка 27: code

````text
scenario = McpScenario(
    task_description="Which department has the most active projects?",
    max_turns=MAX_TURNS,
)

# Run the model
result_trajectory = await rollout(model, scenario)

# Extract the model's response
messages = result_trajectory.messages()
model_response = messages[-1]["content"] if messages else "No response"

print(f"Model output: {model_response}")
print("-" * 80)
````

## Ячейка 28: code

````text

````

## Ячейка 29: code

````text
# @title Upload to Hugging Face 🤗

# Adapted from Unsloth Notebooks (https://github.com/unslothai/notebooks), licensed under GNU LGPL v3.0.
# © Unsloth contributors. Modifications © 2025 OpenPipe, Inc.
# See THIRD-PARTY-NOTICES and licenses/LGPL-3.0.txt for details.

import torch
from unsloth import FastLanguageModel

lora_model_path = (
    f".art/{model.project}/models/{model.name}/checkpoints/{await model.get_step():04d}"
)

peft_model, peft_tokenizer = FastLanguageModel.from_pretrained(
    model_name=lora_model_path,
    max_seq_length=16384,
    dtype=torch.bfloat16,
    load_in_4bit=True,
)

UPLOAD_MODEL = False  # Set True when you're ready to upload your model to Hugging Face
HF_ACCOUNT = "your_hf_account"
HF_TOKEN = "your_hf_token"

if UPLOAD_MODEL:
    peft_model.push_to_hub_merged(
        f"{HF_ACCOUNT}/{model.name}", peft_tokenizer, token=HF_TOKEN
    )
````

## Ячейка 30: markdown

### Next Steps

Congratulations! You've successfully trained a custom model for your task using only:
- A pre-built MCP server
- Example inputs (no outputs needed!)
- RULER's automatic evaluation

Here are some ways to improve results:

1. **More diverse inputs**: Generate more varied input examples
2. **Longer training**: Increase the number of training steps
3. **More comparisons**: Increase `rollouts_per_group` for better RULER comparisons
4. **MCP server refinement**: Add better tools and resources to the server
5. **Hyperparameter tuning**: Adjust learning rate, batch size, etc.

Remember: RULER learns what "good" means from your MCP server alone - no labeled data required!

For more advanced use cases, check out the [ART documentation](https://art.openpipe.ai).