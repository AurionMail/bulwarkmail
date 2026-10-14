"use client";

import { createContext, useContext, useState, useCallback, useRef, ReactNode } from "react";
import { Email } from "@/lib/jmap/types";
import { dragDropHooks } from "@/lib/plugin-hooks";

interface DragDropState {
  isDragging: boolean;
  draggedEmails: Email[];
  dragCount: number;
  sourceMailboxId: string | null;
}

interface DragDropContextValue extends DragDropState {
  startDrag: (emails: Email[], sourceMailboxId: string) => void;
  endDrag: () => void;
  /** A drop target accepted the dragged messages. */
  markDropped: () => void;
}

const initialState: DragDropState = {
  isDragging: false,
  draggedEmails: [],
  dragCount: 0,
  sourceMailboxId: null,
};

const DragDropContext = createContext<DragDropContextValue | null>(null);

export function DragDropProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DragDropState>(initialState);
  // The drag plugins were told about; endDrag runs more than once per drag
  // (the drop target and the dragged row both call it).
  const current = useRef<{ ids: string[]; dropped: boolean } | null>(null);

  const startDrag = useCallback((emails: Email[], sourceMailboxId: string) => {
    current.current = { ids: emails.map((e) => e.id), dropped: false };
    void dragDropHooks.onDragStart.emit({ kind: "email", ids: current.current.ids });
    setState({
      isDragging: true,
      draggedEmails: emails,
      dragCount: emails.length,
      sourceMailboxId,
    });
  }, []);

  const endDrag = useCallback(() => {
    const drag = current.current;
    current.current = null;
    if (drag) void dragDropHooks.onDragEnd.emit({ kind: "email", ids: drag.ids, dropped: drag.dropped });
    setState(initialState);
  }, []);

  const markDropped = useCallback(() => {
    if (current.current) current.current.dropped = true;
  }, []);

  return (
    <DragDropContext.Provider value={{ ...state, startDrag, endDrag, markDropped }}>
      {children}
    </DragDropContext.Provider>
  );
}

export function useDragDropContext() {
  const context = useContext(DragDropContext);
  if (!context) {
    throw new Error("useDragDropContext must be used within DragDropProvider");
  }
  return context;
}
