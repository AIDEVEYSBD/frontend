"use client";

import { createContext, useContext } from "react";

/**
 * What a `Field` tells the control inside it: the id its label points at,
 * the id of the help or error line to describe it by, and whether the field
 * is currently in error. A control outside any Field gets nothing and
 * behaves exactly as before.
 */
export interface FieldState {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

export const FieldContext = createContext<FieldState | null>(null);

export function useField(): FieldState | null {
  return useContext(FieldContext);
}
