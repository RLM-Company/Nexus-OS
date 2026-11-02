# Исходные ячейки: Build-reasoning-model/Own_reasoning_model_with_GRPO.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
# Reference: https://unsloth.ai/blog/r1-reasoning
````

## Ячейка 1: code

````text
!pip install unsloth vllm
!pip install --upgrade pillow
!pip install git+https://github.com/huggingface/trl.git@e95f9fb74a3c3647b86f251b7e230ec51c64b72b
````

## Ячейка 2: code

````text
from unsloth import FastLanguageModel, PatchFastRL
PatchFastRL("GRPO", FastLanguageModel)
````

## Ячейка 3: code

````text
from unsloth import is_bfloat16_supported
import torch
max_seq_length = 512
lora_rank = 8

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "meta-llama/meta-Llama-3.1-8B-Instruct",
    max_seq_length = max_seq_length,
    load_in_4bit = True,
    fast_inference = True,
    max_lora_rank = lora_rank,
    gpu_memory_utilization = 0.6,
)

model = FastLanguageModel.get_peft_model(
    model,
    r = lora_rank,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",],
    lora_alpha = lora_rank,
    use_gradient_checkpointing = "unsloth",
)
````

## Ячейка 4: code

````text
from datasets import load_dataset
import re

SYSTEM_PROMPT = """
Respond in the following format:
<reasoning>
...
</reasoning>
<answer>
...
</answer>
"""

def extract_hash_answer(text: str) -> str | None:
    if "####" not in text:
        return None
    return text.split("####")[1].strip()

# uncomment middle messages for 1-shot prompting
def create_dataset(split = "train"):
    data = load_dataset('openai/gsm8k', 'main')[split] # type: ignore
    data = data.map(lambda x: { # type: ignore
        'prompt': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': x['question']}
        ],
        'answer': extract_hash_answer(x['answer'])
    }) # type: ignore
    return data # type: ignore

dataset = create_dataset()
````

## Ячейка 5: code

````text
def extract_xml_answer(text: str) -> str:
    answer = text.split("<answer>")[-1]
    answer = answer.split("</answer>")[0]
    return answer.strip()

def correctness_reward_func(prompts, completions, answer, **kwargs) -> list[float]:
    responses = [completion[0]['content'] for completion in completions]
    q = prompts[0][-1]['content']
    extracted_responses = [extract_xml_answer(r) for r in responses]
    print('-'*20, f"Question:\n{q}", f"\nAnswer:\n{answer[0]}", f"\nResponse:\n{responses[0]}", f"\nExtracted:\n{extracted_responses[0]}")
    return [2.0 if r == a else 0.0 for r, a in zip(extracted_responses, answer)]

def int_reward_func(completions, **kwargs) -> list[float]:
    responses = [completion[0]['content'] for completion in completions]
    extracted_responses = [extract_xml_answer(r) for r in responses]
    return [0.5 if r.isdigit() else 0.0 for r in extracted_responses]

def strict_format_reward_func(completions, **kwargs) -> list[float]:
    """Reward function that checks if the completion has a specific format."""
    pattern = r"^<reasoning>\n.*?\n</reasoning>\n<answer>\n.*?\n</answer>\n$"
    responses = [completion[0]["content"] for completion in completions]
    matches = [re.match(pattern, r) for r in responses]
    return [0.5 if match else 0.0 for match in matches]

def soft_format_reward_func(completions, **kwargs) -> list[float]:
    """Reward function that checks if the completion has a specific format."""
    pattern = r"<reasoning>.*?</reasoning>\s*<answer>.*?</answer>"
    responses = [completion[0]["content"] for completion in completions]
    matches = [re.match(pattern, r) for r in responses]
    return [0.5 if match else 0.0 for match in matches]

def count_xml(text) -> float:
    count = 0.0
    if text.count("<reasoning>\n") == 1:
        count += 0.125
    if text.count("\n</reasoning>\n") == 1:
        count += 0.125
    if text.count("\n<answer>\n") == 1:
        count += 0.125
        count -= len(text.split("\n</answer>\n")[-1])*0.001
    if text.count("\n</answer>") == 1:
        count += 0.125
        count -= (len(text.split("\n</answer>")[-1]) - 1)*0.001
    return count

def xmlcount_reward_func(completions, **kwargs) -> list[float]:
    contents = [completion[0]["content"] for completion in completions]
    return [count_xml(c) for c in contents]
````

## Ячейка 6: code

````text
from trl import GRPOConfig

training_args = GRPOConfig(
    use_vllm = True,
    learning_rate = 5e-6,
    adam_beta1 = 0.9,
    adam_beta2 = 0.99,
    weight_decay = 0.1,
    warmup_ratio = 0.1,
    lr_scheduler_type = "cosine",
    optim = "paged_adamw_8bit",
    logging_steps = 1,
    bf16 = is_bfloat16_supported(),
    fp16 = not is_bfloat16_supported(),
    per_device_train_batch_size = 1,
    gradient_accumulation_steps = 1,
    num_generations = 6,
    max_prompt_length = 256,
    max_completion_length = 200,
    max_steps = 250,
    save_steps = 250,
    max_grad_norm = 0.1,
    report_to = "none",
    output_dir = "outputs",
)
````

## Ячейка 7: code

````text
from trl import GRPOTrainer

trainer = GRPOTrainer(
    model = model,
    processing_class = tokenizer,
    reward_funcs = [
        xmlcount_reward_func,
        soft_format_reward_func,
        strict_format_reward_func,
        int_reward_func,
        correctness_reward_func,
    ],
    args = training_args,
    train_dataset = dataset,
)
trainer.train()
````

## Ячейка 8: code

````text
from vllm import SamplingParams
````

## Ячейка 9: code

````text
# Regular model
query = "which is bigger 9.11 or 9.9?"

text = tokenizer.apply_chat_template([
    {"role" : "user", "content" : query},
], tokenize = False, add_generation_prompt = True)


output = model.fast_generate([text],
                             sampling_params = SamplingParams(
                                 temperature = 0.8,
                                 top_p = 0.95,
                                 max_tokens = 1024),
                             lora_request = None
                             )[0].outputs[0].text

print(output)
````

## Ячейка 10: code

````text
model.save_lora("grpo_saved_lora")
````

## Ячейка 11: code

````text
# Model with LoRA weights

query = "which is bigger 9.11 or 9.9?"

text = tokenizer.apply_chat_template([
    {"role" : "system", "content" : SYSTEM_PROMPT},
    {"role" : "user", "content" : query},
], tokenize = False, add_generation_prompt = True)


output = model.fast_generate(text,
                             sampling_params = SamplingParams(
                                 temperature = 0.8,
                                 top_p = 0.95,
                                 max_tokens = 1024),
                             lora_request = model.load_lora("grpo_saved_lora"),
                             )[0].outputs[0].text

print(output)
````