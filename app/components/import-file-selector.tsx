'use client';

type ImportFileSelectorProps = {
  accept: string;
  ariaLabel: string;
  filename?: string | null;
  onFileChange: (file: File | undefined) => void;
};

export function ImportFileSelector({ accept, ariaLabel, filename, onFileChange }: ImportFileSelectorProps) {
  return <label className="inline-flex min-w-0 flex-wrap items-center gap-3 cursor-pointer">
    <input
      className="peer sr-only"
      type="file"
      accept={accept}
      aria-label={ariaLabel}
      onChange={event => {
        onFileChange(event.currentTarget.files?.[0]);
        event.currentTarget.value = '';
      }}
    />
    <span className="btn-secondary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange-600">Choose File</span>
    <span className="min-w-0 break-all text-sm text-slate-600" aria-live="polite">{filename || 'No file selected'}</span>
  </label>;
}
