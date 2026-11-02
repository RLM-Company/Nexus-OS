# Исходные ячейки: mcp-video-rag/video_rag.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Video-RAG using Ragie

This notebook demonstrates how to build a video-based Retrieval Augmented Generation (RAG) system. It uses [Ragie's](https://www.ragie.ai/) video ingestion and retrieval capabilities to enable semantic search and Q&A over video content.

## Ячейка 1: code

````text
import os
import time

from dotenv import load_dotenv
from ragie import Ragie

load_dotenv()
````

## Ячейка 2: code

````text
ragie = Ragie(
    auth=os.getenv('RAGIE_API_KEY')
)
````

## Ячейка 3: markdown

## Remove previous data

## Ячейка 4: code

````text
response = ragie.documents.list()       
documents = response.result.documents

for document in documents:
    try:
        ragie.documents.delete(
            document_id=document.id
        )
        print(f"Deleted document {document.id}")
    except Exception as e:
        print(f"Error deleting document {document.id}: {e}")
````

## Ячейка 5: markdown

## Ingestion

## Ячейка 6: code

````text
current_dir = os.path.curdir
file_path = os.path.join(current_dir, 'videos/messi-goals.mp4')
result = ragie.documents.create(request={
    "file": {
        "file_name": "messi-goals.mp4",
        "content": open(file_path, "rb"),
    },
    "mode": {
        "video": "audio_video"
    }
})

print(result)
````

## Ячейка 7: markdown

## Retrieval

## Ячейка 8: code

````text
response =  ragie.retrievals.retrieve(request={
    "query": "Give detailed description of the video with timestamps of the events"
})

print(response)
````

## Ячейка 9: code

````text
content = []
for chunk in response.scored_chunks:
    print(chunk.text)
    print("#"*100)
    content.append({
            **chunk.document_metadata,
            "text": chunk.text,
            "document_name": chunk.document_name,
            "start_time": chunk.metadata.get("start_time"),
            "end_time": chunk.metadata.get("end_time")
        })
````

## Ячейка 10: markdown

## Video chunk creation

## Ячейка 11: code

````text
content[0]
````

## Ячейка 12: markdown

Let's see the above video clip to verify the video_description is correct

## Ячейка 13: code

````text
from moviepy import VideoFileClip

video = VideoFileClip("videos/messi-goals.mp4")
goal_clip = video.subclipped(content[0]['start_time'], content[0]['end_time'])
goal_clip.write_videofile("videos/goal_clip.mp4")
````

## Ячейка 14: code

````text
from IPython.display import HTML
from pathlib import Path

# View the created video chunk
video_path = Path('videos/goal_clip.mp4')
if video_path.exists():
    video_html = f'''
    <video width="640" height="480" controls>
        <source src="{video_path}" type="video/mp4">
        Your browser does not support the video tag.
    </video>
    '''
    display(HTML(video_html))
else:
    print("Video file not found!")
````

## Ячейка 15: code

````text

````