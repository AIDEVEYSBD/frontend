"use client";

import { useEffect, useState } from "react";

/**
 * The models this factory offers — the list picked on the Configuration page,
 * not the whole catalogue. Every model dropdown in the builder reads this, so
 * changing the offer in one place changes it everywhere.
 */
export type ModelClass = "small" | "medium" | "large";

export interface OfferedModel {
  id: string;
  label: string;
  /** Capability tier the operator assigned on the Configuration page. */
  class?: ModelClass;
}

export const MODEL_CLASSES: ModelClass[] = ["small", "medium", "large"];

const FALLBACK: OfferedModel[] = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
];

export function useModels(): {
  models: OfferedModel[];
  defaultModel: string;
  classDefaults: Partial<Record<ModelClass, string>>;
} {
  const [models, setModels] = useState<OfferedModel[]>(FALLBACK);
  const [defaultModel, setDefaultModel] = useState(FALLBACK[0].id);
  const [classDefaults, setClassDefaults] = useState<Partial<Record<ModelClass, string>>>({});

  useEffect(() => {
    let stop = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (stop || !Array.isArray(d.models) || !d.models.length) return;
        setModels(d.models);
        setDefaultModel(String(d.default_model || d.models[0].id));
        setClassDefaults(d.class_defaults && typeof d.class_defaults === "object" ? d.class_defaults : {});
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  return { models, defaultModel, classDefaults };
}
