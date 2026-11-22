"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/lib/api/client";

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
  /** The endpoint this model is called on (lib/providers.ts). */
  provider?: string;
  /** USD per million tokens; null when no price is set. */
  price_in?: number | null;
  price_out?: number | null;
}

export const MODEL_CLASSES: ModelClass[] = ["small", "medium", "large"];

// Nothing is offered until the Configuration page says so: a model id here
// is a name one of the deployment's endpoints serves, and only the endpoint knows those.
const FALLBACK: OfferedModel[] = [];

/**
 * `read` turns true once `GET /api/config` has answered with the list (an
 * empty one included); `error` says why it could not be read, so a picker
 * never goes blank without a word.
 */
export function useModels(): {
  models: OfferedModel[];
  defaultModel: string;
  classDefaults: Partial<Record<ModelClass, string>>;
  read: boolean;
  error: string;
} {
  const [models, setModels] = useState<OfferedModel[]>(FALLBACK);
  const [defaultModel, setDefaultModel] = useState("");
  const [classDefaults, setClassDefaults] = useState<Partial<Record<ModelClass, string>>>({});
  const [read, setRead] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    fetch("/api/config")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !Array.isArray(d.models)) throw new Error(errorText(d, r, "GET", "/api/config"));
        return d;
      })
      .then((d) => {
        if (stop) return;
        setRead(true);
        setError("");
        if (!d.models.length) return;
        setModels(d.models);
        setDefaultModel(String(d.default_model || d.models[0].id));
        setClassDefaults(d.class_defaults && typeof d.class_defaults === "object" ? d.class_defaults : {});
      })
      .catch((e) => {
        if (!stop) setError((e as Error).message || "the backend did not answer GET /api/config");
      });
    return () => {
      stop = true;
    };
  }, []);

  return { models, defaultModel, classDefaults, read, error };
}
