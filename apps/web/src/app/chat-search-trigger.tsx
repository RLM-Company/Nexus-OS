"use client";
import { useRef, useState } from "react";
import { ChatSearch, type SearchableChatMessage } from "./chat-search";
import { WorkspaceIcon } from "./workspace-icons";

export function ChatSearchTrigger({
  title,
  messages
}: {
  title: string;
  messages: SearchableChatMessage[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        className="chat-search-trigger"
        ref={trigger}
        type="button"
        aria-label="Поиск в чате"
        title="Поиск в чате"
        onClick={() => setOpen(true)}
      >
        <WorkspaceIcon name="search" />
      </button>
      <ChatSearch
        open={open}
        title={title}
        messages={messages}
        onClose={(jumped) => {
          setOpen(false);
          if (!jumped) trigger.current?.focus();
        }}
      />
    </>
  );
}
