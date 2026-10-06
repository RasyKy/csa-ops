"use client";

import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";

import { useCaseContext } from "./CaseProvider";

const NOTE_MAX = 2000;
const CONFLICT_MESSAGE = "This case was changed by someone else. Showing the latest version.";

export function NoteBox() {
  const { addNote, pending } = useCaseContext();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const empty = text.trim() === "";

  async function submit() {
    if (empty || pending) return;
    setError("");
    const result = await addNote(text);
    if (result.ok) {
      setText("");
    } else {
      setError(result.status === 409 ? CONFLICT_MESSAGE : (result.message ?? "The note could not be saved."));
    }
    areaRef.current?.focus();
  }

  return (
    <form
      className="border-b border-line px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        Add a note
      </label>
      <textarea
        ref={areaRef}
        id={id}
        rows={3}
        maxLength={NOTE_MAX}
        value={text}
        placeholder="What did you find? What did you check?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        className="mt-1 w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="mt-1 flex items-start justify-between gap-3">
        <p role="alert" className="min-h-[1.25rem] text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <p className="shrink-0 text-xs text-ink-subtle" data-testid="note-counter">
          {text.length} / {NOTE_MAX}
        </p>
      </div>
      <div className="mt-2 flex justify-end">
        <Button type="submit" variant="primary" disabled={empty || pending}>
          Add note
        </Button>
      </div>
    </form>
  );
}
