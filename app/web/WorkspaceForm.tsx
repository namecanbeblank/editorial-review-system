import { useEffect, useState } from "react";
import type { ClientConfig } from "../../engine/dist/schema.js";

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Save workspace",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed – retry",
};

type FeatureGlossaryEntry = { canonical: string; banned: string[] };

/** A labeled list of single-line text rows with add/remove buttons -- the editable
 *  string-list UI the spec asks for (differentiators, competitors, productAliases,
 *  bannedPhrases, proofBank). One reusable component rather than one per field. */
function StringListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="field list-field">
      <label>{label}</label>
      {values.map((value, i) => (
        <div className="list-row" key={i}>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...values, ""])}>
        + Add
      </button>
    </div>
  );
}

/** featureGlossary rows: {canonical, banned: string[]} per engine/src/schema.ts's
 *  actual shape -- a canonical name plus its own nested banned-paraphrase list. */
function FeatureGlossaryField({
  values,
  onChange,
}: {
  values: FeatureGlossaryEntry[];
  onChange: (next: FeatureGlossaryEntry[]) => void;
}) {
  return (
    <div className="field list-field">
      <label>Feature glossary</label>
      {values.map((entry, i) => (
        <div className="glossary-row" key={i}>
          <input
            type="text"
            placeholder="Canonical name (e.g. Blueprint)"
            value={entry.canonical}
            onChange={(e) =>
              onChange(values.map((v, j) => (j === i ? { ...v, canonical: e.target.value } : v)))
            }
          />
          <StringListField
            label="Banned paraphrases"
            values={entry.banned}
            onChange={(banned) => onChange(values.map((v, j) => (j === i ? { ...v, banned } : v)))}
          />
          <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            Remove feature
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...values, { canonical: "", banned: [] }])}>
        + Add feature
      </button>
    </div>
  );
}

interface WorkspaceFormProps {
  client: ClientConfig;
  onSave: (config: ClientConfig) => Promise<void>;
}

/**
 * LEFT pane, "Workspace" section (Wave 3, PLAN.md P6 2a; `requiredVocabulary` added
 * Wave 4 polish item 1): the full editable ClientConfig form -- name/icp/positioning as
 * textareas, five editable string-lists, proofBank as its own list, featureGlossary as
 * canonical+banned rows.
 *
 * Local `form` state is a working copy of the `client` prop, reset only when a
 * DIFFERENT client config arrives (a client switch, or the object this component's own
 * onSave just persisted) -- never on an unrelated parent re-render, which would
 * otherwise blow away in-progress edits.
 */
export default function WorkspaceForm({ client, onSave }: WorkspaceFormProps) {
  const [form, setForm] = useState<ClientConfig>(client);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    setForm(client);
  }, [client]);

  async function handleSave() {
    setSaveState("saving");
    try {
      await onSave({ ...form, bannedPhrases: form.bannedPhrases?.filter((phrase) => phrase.trim().length > 0) });
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("error");
    }
  }

  return (
    <details className="collapsible" open>
      <summary>Workspace</summary>
      <div className="collapsible-body">
        <div className="field">
          <label htmlFor="ws-name">Name</label>
          <textarea id="ws-name" rows={1} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ws-icp">ICP</label>
          <textarea id="ws-icp" value={form.icp} onChange={(e) => setForm({ ...form, icp: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="ws-positioning">Positioning</label>
          <textarea
            id="ws-positioning"
            value={form.positioning}
            onChange={(e) => setForm({ ...form, positioning: e.target.value })}
          />
        </div>
        <StringListField
          label="Differentiators"
          values={form.differentiators}
          onChange={(differentiators) => setForm({ ...form, differentiators })}
        />
        <StringListField
          label="Competitors"
          values={form.competitors}
          onChange={(competitors) => setForm({ ...form, competitors })}
        />
        <StringListField
          label="Product aliases"
          values={form.productAliases}
          onChange={(productAliases) => setForm({ ...form, productAliases })}
        />
        <StringListField
          label="Banned phrases"
          values={form.bannedPhrases}
          onChange={(bannedPhrases) => setForm({ ...form, bannedPhrases })}
        />
        <StringListField
          label="Required vocabulary"
          values={form.requiredVocabulary ?? []}
          onChange={(requiredVocabulary) => setForm({ ...form, requiredVocabulary })}
        />
        <StringListField
          label="Proof bank"
          values={form.proofBank}
          onChange={(proofBank) => setForm({ ...form, proofBank })}
        />
        <FeatureGlossaryField
          values={form.featureGlossary ?? []}
          onChange={(featureGlossary) => setForm({ ...form, featureGlossary })}
        />
        <button type="button" className="workspace-form-save" onClick={handleSave} disabled={saveState === "saving"}>
          {SAVE_LABEL[saveState]}
        </button>
      </div>
    </details>
  );
}
