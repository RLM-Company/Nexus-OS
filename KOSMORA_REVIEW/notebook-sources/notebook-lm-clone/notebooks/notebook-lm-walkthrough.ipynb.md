# Исходные ячейки: notebook-lm-clone/notebooks/notebook-lm-walkthrough.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Build your own NotebookLM

This notebook walks you through all the core functionalities of our NotebookLM implementation, from document processing and content extraction to memory integration and podcast generation. Each section includes both explanations and code examples to demonstrate how the system works under the hood.

## Ячейка 1: markdown

## Table of Contents
1. [Document Processing](#1-document-processing)
2. [Audio Transcription](#2-audio-transcription)
3. [Web Scraping](#3-web-scraping)
4. [Embedding Generation](#4-embedding-generation)
5. [Vector Database Storage](#5-vector-database-storage)
6. [Memory Layer Integration](#6-memory-layer-integration)
7. [RAG Query Processing](#7-rag-query-processing)
8. [Memory Storage for Conversations](#8-memory-storage-for-conversations)
9. [Podcast Script Generation](#9-podcast-script-generation)
10. [Text-to-Speech Audio Generation](#10-text-to-speech-audio-generation)

## Ячейка 2: code

````text
# Necessary imports
import os
import datetime
import tempfile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
````

## Ячейка 3: markdown

## 1. Document Processing

The document processing module handles various file formats (PDF, TXT, Markdown) and converts them into structured chunks with metadata for citations and retrieval.

## Ячейка 4: markdown

### Key features:
- **Multi-format support**: PDF, TXT, MD files
- **Page tracking**: Maintains page numbers for accurate citations
- **Character positions**: Tracks start/end positions for precise references
- **Metadata preservation**: Source file, type, and processing timestamp

## Ячейка 5: code

````text
from src.document_processing.doc_processor import DocumentProcessor, DocumentChunk

# Initialize the document processor
doc_processor = DocumentProcessor()

# Process a PDF document
pdf_path = "data/raft.pdf"
doc_chunks = doc_processor.process_document(pdf_path)

# Each chunk contains rich metadata for citations
for chunk in doc_chunks[:3]:
    print(f"Chunk ID: {chunk.chunk_id}")
    print(f"Source: {chunk.source_file}")
    print(f"Page: {chunk.page_number}")
    print(f"Content: {chunk.content[:100]}...")
    print(f"Citation Info: {chunk.get_citation_info()}")
    print("-" * 50)

# Process a text file
txt_path = "data/notes.txt"
text_chunks = doc_processor.process_document(txt_path)
print(f"Processed {len(text_chunks)} chunks from text file")
print(f"Citation Info: {text_chunks[0].get_citation_info()}")
````

## Ячейка 6: markdown

## 2. Audio Transcription

Our system supports two types of audio transcription: direct audio files and YouTube videos, both using AssemblyAI for high-accuracy transcription with speaker diarization.

## Ячейка 7: markdown

### Audio Processing Features:
- **Speaker diarization**: Automatically identifies different speakers
- **Timestamp preservation**: Maintains timing information for each utterance
- **High accuracy**: Uses AssemblyAI's advanced speech recognition
- **YouTube integration**: Audio download with yt-dlp + audio transcription with AssemblyAI

## Ячейка 8: markdown

### 2.1 Direct Audio Transcription

## Ячейка 9: code

````text
from src.audio_processing.audio_transcriber import AudioTranscriber

# Initialize with AssemblyAI API key
# audio_transcriber = AudioTranscriber("your_assemblyai_api_key")
audio_transcriber = AudioTranscriber(os.getenv("ASSEMBLYAI_API_KEY"))

# Transcribe an audio file with speaker diarization
audio_path = "data/harvard.wav"
audio_chunks = audio_transcriber.transcribe_audio(
    audio_path,
    enable_speaker_diarization=True,
    enable_auto_punctuation=True
)

# Each chunk represents a speaker utterance
for chunk in audio_chunks[:5]:
    print(f"\nSpeaker: {chunk.metadata.get('speakers', [])}")
    print(f"Time: {chunk.metadata.get('start_timestamp', 0)/1000:.2f}s - {chunk.metadata.get('end_timestamp', 0)/1000:.2f}s")
    print(f"Content: {chunk.content}")
    print(f"Confidence: {chunk.metadata.get('confidence', 'N/A'):.3f}")
    print("-" * 40)
````

## Ячейка 10: markdown

### 2.2 YouTube Video Transcription

## Ячейка 11: code

````text
from src.audio_processing.youtube_transcriber import YouTubeTranscriber

# Initialize YouTube transcriber
youtube_transcriber = YouTubeTranscriber(os.getenv("ASSEMBLYAI_API_KEY"))

# Extract and transcribe YouTube video
youtube_url = "https://www.youtube.com/watch?v=D26sUZ6DHNQ"
youtube_chunks = youtube_transcriber.transcribe_youtube_video(youtube_url)

print(f"Transcribed {len(youtube_chunks)} utterances from YouTube video")

# Show speaker-separated content
for chunk in youtube_chunks[:3]:
    print(f"Video ID: {chunk.metadata.get('video_id')}")
    print(f"Speaker: {chunk.metadata.get('speaker')}")
    print(f"Timestamp: {chunk.metadata.get('start_time')}s")
    print(f"Content: {chunk.content}")
    print("-" * 40)
````

## Ячейка 12: markdown

## 3. Web Scraping

The web scraping module uses Firecrawl to extract clean, structured content from websites while preserving the context needed for citations.

## Ячейка 13: markdown

### Web Scraping Features:
- **Clean extraction**: Removes ads, navigation, and irrelevant content
- **Metadata preservation**: Preserves title, URL, and page structure
- **Citation-ready**: URL fragments for precise source linking
- **Chunking**: Intelligent text segmentation with overlap

## Ячейка 14: code

````text
from src.web_scraping.web_scraper import WebScraper

# Initialize with Firecrawl API key
# web_scraper = WebScraper("your_firecrawl_api_key")
web_scraper = WebScraper(os.getenv("FIRECRAWL_API_KEY"))
# Scrape a website
url = "https://blog.dailydoseofds.com/p/5-chunking-strategies-for-rag"
web_chunks = web_scraper.scrape_url(url)

print(f"Scraped {len(web_chunks)} chunks from {url}")

# Each chunk contains web-specific metadata
for chunk in web_chunks[:2]:
    print(f"URL: {chunk.metadata.get('original_url', 'N/A')}")
    print(f"Title: {chunk.metadata.get('title', 'No title')}")
    print(f"Chunk: {chunk.chunk_index}")
    print(f"Content: {chunk.content[:200]}...")
    print(f"Citation: [Source: {chunk.source_file}, Type: {chunk.source_type}]")
    print(f"URL Fragment: {chunk.metadata.get('url_fragment')}")
    print("-" * 50)
````

## Ячейка 15: markdown

## 4. Embedding Generation

After processing all modalities (documents, audio, web), we generate semantic embeddings for each chunk to enable similarity search and retrieval.

## Ячейка 16: markdown

### Embedding Features:
- **Efficient embedding model**: BGE (BAAI General Embedding) for high-quality embeddings
- **Batch processing**: Efficient embedding generation for large document sets
- **Query optimization**: Specialized query embedding for better retrieval

## Ячейка 17: code

````text
from src.embeddings.embedding_generator import EmbeddingGenerator

# Initialize embedding generator with BGE model
embedding_generator = EmbeddingGenerator(model_name="BAAI/bge-small-en-v1.5")

# Generate embeddings for all processed chunks
all_chunks = doc_chunks + text_chunks + audio_chunks + youtube_chunks + web_chunks
# all_chunks = doc_chunks + text_chunks + audio_chunks + web_chunks
embedded_chunks = embedding_generator.generate_embeddings(all_chunks)

print(f"Generated embeddings for {len(embedded_chunks)} chunks")
print(f"Embedding dimension: {embedded_chunks[0].embedding.shape[0]}")

# Show embedding information
for i, embedded_chunk in enumerate(embedded_chunks[:3]):
    print(f"\nChunk {i+1}:")
    print(f"Source: {embedded_chunk.chunk.source_file}")
    print(f"Type: {embedded_chunk.chunk.source_type}")
    print(f"Embedding shape: {embedded_chunk.embedding.shape}")
    print(f"Content preview: {embedded_chunk.chunk.content[:100]}...")
    print(f"Embedding vector: {embedded_chunk.embedding[:50]}...")

# Generate query embedding for search
query = "What is the main topic of research?"
query_embedding = embedding_generator.generate_query_embedding(query)
print(f"\nQuery embedding shape: {query_embedding.shape}")
print(f"Query embedding vector: {query_embedding[:50]}...")
````

## Ячейка 18: markdown

## 5. Vector Database Storage

All embedded chunks are stored in Milvus vector database with comprehensive metadata for fast similarity search and precise citations.

## Ячейка 19: markdown

### Vector Database Features:
- **Milvus Lite**: Embedded vector database for fast deployment
- **IVF_FLAT indexing**: Optimized for accuracy and speed
- **Rich metadata**: Complete citation information stored with vectors
- **Flexible search**: Score thresholding and result limiting
- **Precise retrieval**: Get exact chunks by ID for citations

## Ячейка 20: code

````text
from src.vector_database.milvus_vector_db import MilvusVectorDB

# Initialize Milvus vector database
vector_db = MilvusVectorDB(
    db_path="./milvus_lite.db",
    collection_name="notebookLM_collection"
)

# Create index for fast similarity search
vector_db.create_index()

# Insert all embedded chunks
vector_db.insert_embeddings(embedded_chunks)
print(f"Stored {len(embedded_chunks)} embeddings in vector database")

# Perform similarity search
query_embedding = embedding_generator.generate_query_embedding(
    "Most prominent quantum computing algorithms"
)

search_results = vector_db.search(
    query_embedding,
    limit=5,
)

print(f"\nFound {len(search_results)} relevant chunks:")
for result in search_results:
    print(f"Score: {result['score']:.3f}")
    print(f"Source: {result['citation']['source_file']}")
    print(f"Type: {result['citation']['source_type']}")
    print(f"Content: {result['content'][:100]}...")
    print("-" * 40)

# Retrieve specific chunk by ID
chunk_id = search_results[0]['id']
chunk_data = vector_db.get_chunk_by_id(chunk_id)
print(f"\nRetrieved chunk: {chunk_data['source_file']}")
````

## Ячейка 21: markdown

## 6. Memory Layer Integration

The memory layer uses Zep to maintain conversation context and user sessions, enabling personalized and contextual interactions.

## Ячейка 22: markdown

### Memory Features:
- **Session management**: Persistent user sessions across interactions
- **Context preservation**: Maintains conversation history and context
- **Source tracking**: Remembers which documents were referenced
- **User personalization**: Adapts responses based on user preferences

## Ячейка 23: code

````text
from src.memory.memory_layer import NotebookMemoryLayer

# Initialize memory layer with Zep
memory = NotebookMemoryLayer(
    user_id="demo_user",
    session_id="demo_session",
    create_new_session=True
)

# Memory automatically tracks conversations
print(f"Memory initialized for user: {memory.user_id}")
print(f"Session ID: {memory.session_id}")

# Memory will be used by RAG system to:
# 1. Maintain conversation context
# 2. Store user preferences
# 3. Track document interactions
# 4. Enable follow-up questions

# Memory stores all conversation context for future reference
print("Memory layer ready for conversation tracking")
````

## Ячейка 24: markdown

## 7. Intelligent Response generation

The RAG (Retrieval-Augmented Generation) system combines vector search with LLM generation to provide accurate, cited responses grounded in our source documents.

## Ячейка 25: markdown

### RAG Features:
- **Semantic retrieval**: Finds most relevant chunks using vector similarity
- **Citation integration**: Automatic inline citations with source tracking
- **Context optimization**: Intelligent chunk selection and formatting
- **LLM integration**: Uses powerful LLMs for natural response generation
- **Source transparency**: Complete traceability of information sources

## Ячейка 26: code

````text
from src.generation.rag import RAGGenerator

# Initialize RAG system
rag_generator = RAGGenerator(
    embedding_generator=embedding_generator,
    vector_db=vector_db,
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    model_name="gpt-4o-mini"
)

# Process a user query
user_query = "What is RAFT and how does it differ from RAG and fine tuning?"

# RAG system performs:
# 1. Query embedding generation
# 2. Vector similarity search
# 3. Context formatting with citations
# 4. LLM response generation
# 5. Citation integration

rag_result = rag_generator.generate_response(user_query)

print(f"Query: {rag_result.query}")
print(f"Response: {rag_result.response}")
print(f"Sources used: {len(rag_result.sources_used)}")

# Show citation details
for i, source in enumerate(rag_result.sources_used, 1):
    print(f"\n[{i}] {source['source_file']}")
    if source.get('page_number'):
        print(f"    Page: {source['page_number']}")
    print(f"    Type: {source['source_type']}")
    print(f"    Relevance: {source['relevance_score']:.3f}")

# The response includes inline citations like [1], [2], etc.
print(f"\nCitation summary:")
print(rag_result.get_citation_summary())
````

## Ячейка 27: markdown

## 8. Memory Storage for Conversations

Each RAG interaction is stored in memory for context preservation and conversation continuity. Here's what a sample conversation turn looks like:

```
conversation_turn = {
    "user_message": user_query,
    "assistant_response": rag_result.response,
    "sources_used": rag_result.sources_used,
    "timestamp": datetime.now().isoformat(),
    "session_metadata": {
        "retrieval_count": rag_result.retrieval_count,
        "generation_tokens": rag_result.generation_tokens
    }
}
```

## Ячейка 28: markdown

### Memory Storage Features:
- **Automatic storage**: Every conversation turn is preserved
- **Rich metadata**: Includes sources, timestamps, and generation stats
- **Context continuity**: Enables natural follow-up conversations
- **Session management**: Clean session boundaries for different topics

## Ячейка 29: code

````text
# Save the conversation turn to memory
memory.save_conversation_turn(rag_result)
memory.wait_for_indexing()
# Get the conversation context
context = memory.get_conversation_context()
print(f"\nConversation Context:\n{context}")
````

## Ячейка 30: markdown

Memory enables:
1. Follow-up questions with context
2. Reference to previous discussions
3. Personalized responses based on history
4. Source preference learning

## Ячейка 31: code

````text
# Example follow-up query
followup_query = "Can you elaborate more on the distractor and oracle document part?"

# Memory provides context from previous conversation
followup_result = rag_generator.generate_response(followup_query + f"Conversation Context:\n{context}")
# followup_result = rag_generator.generate_response(followup_query)
print(f"\nFollow-up response: {followup_result.response}")

# Clear session when needed
memory.clear_session()
print("\nSession cleared - fresh conversation context")
````

## Ячейка 32: markdown

## 9. Podcast Script Generation

Transform your documents into engaging podcast conversations using AI-powered script generation.

## Ячейка 33: code

````text
from src.podcast.script_generator import PodcastScriptGenerator

# Initialize script generator
script_generator = PodcastScriptGenerator(
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    model_name="gpt-4o-mini"
)

# Generate podcast from document content
url = "https://thinkingmachines.ai/blog/lora/"
web_chunks = web_scraper.scrape_url(url)
# document_content = "\n\n".join([chunk.content for chunk in doc_chunks[:10]])

podcast_script = script_generator.generate_script_from_website(
    website_chunks=web_chunks,
    source_url=url,
    podcast_style="conversational",  # or "educational", "interview", "debate"
    target_duration="10 minutes"
)

print(f"\nGenerated podcast script:")
print(f"Source: {podcast_script.source_document}")
print(f"Total lines: {podcast_script.total_lines}")
# print(f"Estimated duration: {podcast_script.estimated_duration}")

# Display the conversation
for i, line_dict in enumerate(podcast_script.script, 1):
    speaker, dialogue = next(iter(line_dict.items()))
    print(f"\n{i}. {speaker}: {dialogue}")

# Save script as JSON
script_json = podcast_script.to_json()

if not os.path.exists("outputs"):
    os.makedirs("outputs")

with open("outputs/generated_podcast.json", "w") as f:
    f.write(script_json)
print("\nScript saved to outputs/generated_podcast.json")
````

## Ячейка 34: markdown

### Podcast Script Features:
- **Multiple styles**: Conversational, educational, interview, debate formats
- **Duration control**: 5, 10, 15, or 20-minute target lengths
- **Natural dialogue**: AI-generated conversations between two speakers
- **JSON export**: Structured format for further processing

## Ячейка 35: code

````text

````

## Ячейка 36: markdown

## 10. Text-to-Speech Audio Generation

Convert podcast scripts into high-quality multi-speaker audio using Kokoro TTS.

## Ячейка 37: code

````text
!pip install "kokoro>=0.9.4"
````

## Ячейка 38: code

````text
from src.podcast.text_to_speech import PodcastTTSGenerator

# Initialize TTS generator
tts_generator = PodcastTTSGenerator()

# Generate audio from podcast script
output_dir = "outputs/"

audio_files = tts_generator.generate_podcast_audio(
    podcast_script=podcast_script,
    output_dir=output_dir,
    combine_audio=True
)

print(f"Generated {len(audio_files)} audio files:")
for audio_file in audio_files:
    file_name = Path(audio_file).name
    print(f"  - {file_name}")
    
    # Show file info
    if "complete_podcast" in file_name:
        print(f"    📻 Complete podcast ready!")
    elif "speaker_1" in file_name:
        print(f"    🎤 Speaker 1 segment")
    elif "speaker_2" in file_name:
        print(f"    🎤 Speaker 2 segment")

print(f"\nPodcast generation complete!")
print(f"Total segments: {podcast_script.total_lines}")
print(f"Output directory: {output_dir}")

# The complete podcast is ready for playback or distribution
complete_podcast = next(f for f in audio_files if "complete_podcast" in f)
print(f"Complete podcast: {complete_podcast}")
````

## Ячейка 39: markdown

### Text-to-Speech Features:
- **Multi-speaker support**: Distinct voices for Speaker 1 and Speaker 2
- **Natural speech**: Kokoro TTS for high-quality, natural-sounding audio
- **Segment generation**: Individual files for each dialogue segment
- **Audio combining**: Automatic creation of complete podcast file
- **Professional quality**: 24kHz sample rate for clear audio

## Ячейка 40: code

````text

````

## Ячейка 41: markdown

## Complete Workflow Integration

Here's how all components work together in the main application:

## Ячейка 42: code

````text

````

## Ячейка 43: markdown

## Summary

This NotebookLM implementation provides a complete pipeline from raw content to interactive AI conversations and podcast generation:

1. **Multi-modal processing**: Documents, audio, video, and web content
2. **Semantic search**: Vector embeddings for intelligent retrieval
3. **Cited responses**: Transparent source attribution with interactive citations
4. **Memory integration**: Contextual conversations with history
5. **Podcast generation**: AI-powered script creation and text-to-speech

The system is designed to be modular, scalable, and production-ready, with each component handling specific aspects of the content-to-conversation pipeline.

## Ячейка 44: code

````text

````