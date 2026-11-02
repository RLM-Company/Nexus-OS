# Исходные ячейки: multi-modal-rag/clip.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
# ! pip install transformers torch datasets
````

## Ячейка 1: code

````text
from datasets import load_dataset

data = load_dataset(
    "jamescalam/image-text-demo",
    split="train"
)
````

## Ячейка 2: code

````text
data[1]['text']

````

## Ячейка 3: code

````text
# data[10]['image']
````

## Ячейка 4: code

````text
from transformers import CLIPProcessor, CLIPModel
import torch

model_id = "openai/clip-vit-base-patch32"

processor = CLIPProcessor.from_pretrained(model_id)
model = CLIPModel.from_pretrained(model_id)

# move model to device if possible
device = 'cuda' if torch.cuda.is_available() else 'cpu'

model.to(device)
````

## Ячейка 5: code

````text
text = data['text']  # 21
images = data['image']

inputs = processor(
    text=text,
    images=images,
    return_tensors="pt",
    padding=True,
).to(device)

inputs.keys()
````

## Ячейка 6: code

````text
outputs = model(**inputs)
outputs.keys()
````

## Ячейка 7: code

````text
text_emb = outputs.text_embeds
image_emb = outputs.image_embeds
print(text_emb.shape)
print(image_emb.shape)
````

## Ячейка 8: code

````text
data['image'][0].size
````

## Ячейка 9: code

````text
# Instead of numpy normalization, use torch operations
# No need to detach and convert to numpy
text_emb = text_emb / torch.norm(text_emb, dim=1, keepdim=True)
print(text_emb.shape)
print(text_emb.min().item(), text_emb.max().item())

# ... later for image embeddings ...
image_emb = image_emb / torch.norm(image_emb, dim=1, keepdim=True)
print(image_emb.shape)
print(image_emb.min().item(), image_emb.max().item())

# For cosine similarity, use torch operations
cos_sim = torch.mm(text_emb, image_emb.T).detach().numpy()  # matrix multiplication
````

## Ячейка 10: code

````text
import matplotlib.pyplot as plt

plt.imshow(cos_sim)
plt.show()
````

## Ячейка 11: markdown

### Text to image search

## Ячейка 12: code

````text
def search_images(query_text, top_k=5):
    # Process the text query
    inputs = processor(text=[query_text], return_tensors="pt", padding=True).to(device)
    text_features = model.get_text_features(**inputs)
    text_features = text_features / text_features.norm(dim=-1, keepdim=True)
    
    # Calculate similarity scores
    similarity = torch.mm(text_features, image_emb.T)
    
    # Get top-k matches
    values, indices = similarity[0].topk(min(top_k, len(data)))
    
    # Display results
    print(f"\nSearch query: {query_text}")
    print("\nTop matches:")
    
    # Create a figure with subplots
    fig, axes = plt.subplots(1, top_k, figsize=(15, 3))
    
    for i, (idx, score) in enumerate(zip(indices, values)):
        # Print text and score
        print(f"{data['text'][idx]}: {score:.3f}")
        
        # Display image
        axes[i].imshow(data['image'][idx])
        axes[i].axis('off')
        axes[i].set_title(f"Score: {score:.3f}")
    
    plt.tight_layout()
    plt.show()

# Example usage
search_images("Dog running on grass")
````

## Ячейка 13: markdown

## Image to image search

## Ячейка 14: code

````text
def search_similar_images(query_image, top_k=5):
    # Process the query image
    inputs = processor(images=query_image, return_tensors="pt", padding=True).to(device)
    image_features = model.get_image_features(**inputs)
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    
    # Calculate similarity scores
    similarity = torch.mm(image_features, image_emb.T)
    
    # Get top-k matches
    values, indices = similarity[0].topk(min(top_k, len(data)))
    
    # Display query image and results
    fig, axes = plt.subplots(2, top_k, figsize=(15, 6))
    
    # Show query image in the first row, centered
    mid_idx = top_k // 2
    axes[0, mid_idx].imshow(query_image)
    axes[0, mid_idx].axis('off')
    axes[0, mid_idx].set_title('Query Image')
    
    # Hide other axes in the first row
    for i in range(top_k):
        if i != mid_idx:
            axes[0, i].axis('off')
            axes[0, i].set_visible(False)
    
    # Show results in the second row
    print("\nTop matches:")
    for i, (idx, score) in enumerate(zip(indices, values)):
        # Print text and score
        print(f"{data['text'][idx]}: {score:.3f}")
        
        # Display image
        axes[1, i].imshow(data['image'][idx])
        axes[1, i].axis('off')
        axes[1, i].set_title(f"Score: {score:.3f}")
    
    plt.tight_layout()
    plt.show()

# Example usage
search_similar_images(data['image'][0])
````

## Ячейка 15: markdown

## Zero shot classification

## Ячейка 16: code

````text
from PIL import Image
import requests

from transformers import CLIPProcessor, CLIPModel

model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

url = "http://images.cocodataset.org/val2017/000000039769.jpg"
image = Image.open(requests.get(url, stream=True).raw)
````

## Ячейка 17: code

````text
image
````

## Ячейка 18: code

````text
inputs = processor(
    text=["a photo of a cat", "a photo of a dog"],
    images=image,
    return_tensors="pt",
    padding=True,
)

outputs = model(**inputs)
logits_per_image = outputs.logits_per_image
probs = logits_per_image.softmax(dim=1)
probs

````

## Ячейка 19: code

````text
# Process all images from the dataset through CLIP
image_embeddings = []
for image in tqdm(data['image']):
    # Process image through CLIP
    inputs = processor(images=image, return_tensors="pt", padding=True).to(device)
    image_features = model.get_image_features(**inputs)
    
    # Normalize the features
    image_features = image_features / image_features.norm(dim=-1, keepdim=True)
    image_embeddings.append(image_features)

# Stack all embeddings
image_embeddings = torch.cat(image_embeddings)

def semantic_search(query_text, top_k=5):
    # Process the text query
    inputs = processor(text=[query_text], return_tensors="pt", padding=True).to(device)
    text_features = model.get_text_features(**inputs)
    text_features = text_features / text_features.norm(dim=-1, keepdim=True)
    
    # Calculate similarity scores
    similarity = torch.mm(text_features, image_embeddings.T)
    
    # Get top-k matches
    values, indices = similarity[0].topk(min(top_k, len(data)))
    
    return [(data['text'][idx], values[i].item()) for i, idx in enumerate(indices)]

# Example search
query = "a beautiful sunset over mountains"
results = semantic_search(query)

# Display results
print(f"\nSearch query: {query}")
print("\nTop matches:")
for text, score in results:
    print(f"{text}: {score:.3f}")
````