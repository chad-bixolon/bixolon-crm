'use client';
import { EntityPicker } from './entity-picker';
export function AudienceContactPicker() {
  return <EntityPicker type="contact" label="Manually include Contact" name="contactId" required/>;
}
