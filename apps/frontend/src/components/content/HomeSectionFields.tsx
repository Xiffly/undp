import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SiteContentEntry, HomeCta, BlockNode, SectionPresentation } from '../../types';
import BlockEditor from './BlockEditor';
import { usesStructuredBody } from './managerHelpers';

interface Props {
  selectedSection: SiteContentEntry;
  replaceDraftSection: (section: SiteContentEntry) => void;
  setSectionBlocks: (blocks: BlockNode[]) => void;
  selectedPresentation: SectionPresentation;
  updatePresentation: (patch: Record<string, unknown>) => void;
  heroCtas: HomeCta[];
  updateCtas: (ctas: HomeCta[]) => void;
  statsItems: Array<{ id: string; label: string; value: string; icon: string }>;
  updateStatsItems: (items: Array<{ id: string; label: string; value: string; icon: string }>) => void;
  howSteps: Array<{ id: string; title: string; bullets: string[]; icon: string }>;
  updateHowSteps: (steps: Array<{ id: string; title: string; bullets: string[]; icon: string }>) => void;
  cancelSectionChanges: () => void;
  publishSection: () => Promise<void>;
  canPublish: boolean;
}

export default function HomeSectionFields({ selectedSection, replaceDraftSection, setSectionBlocks, selectedPresentation, updatePresentation, heroCtas, updateCtas, statsItems, updateStatsItems, howSteps, updateHowSteps, cancelSectionChanges, publishSection, canPublish }: Props) {
  const { t } = useTranslation();
  return (<div className="grid gap-5">
                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.content_section', { defaultValue: 'Content' })}</h3>
                    <div className="grid gap-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_title', { defaultValue: 'Title' })}</label>
                        <textarea value={selectedSection.title} onChange={(event) => replaceDraftSection({ ...selectedSection, title: event.target.value })} rows={selectedSection.key === 'home.hero' ? 2 : 1} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_description', { defaultValue: 'Description' })}</label>
                        <textarea value={selectedSection.description} onChange={(event) => replaceDraftSection({ ...selectedSection, description: event.target.value })} rows={3} className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm" />
                      </div>
                        {usesStructuredBody(selectedSection.key) && (
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_structured_body', { defaultValue: 'Structured Body' })}</label>
                            <BlockEditor blocks={selectedSection.body_document || []} onChange={setSectionBlocks} />
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-4">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.layout_section', { defaultValue: 'Layout' })}</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_section_label', { defaultValue: 'Section Label' })}</label>
                        <input value={selectedPresentation.section_label || ''} onChange={(event) => updatePresentation({ section_label: event.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_eyebrow', { defaultValue: 'Eyebrow' })}</label>
                        <input value={selectedPresentation.eyebrow || ''} onChange={(event) => updatePresentation({ eyebrow: event.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_subheading', { defaultValue: 'Subheading' })}</label>
                        <input value={selectedPresentation.subheading || ''} onChange={(event) => updatePresentation({ subheading: event.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_container_width', { defaultValue: 'Container Width' })}</label>
                        <select value={selectedPresentation.container_width_token || 'default'} onChange={(event) => updatePresentation({ container_width_token: event.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
                          <option value="narrow">{t('admin.content_manager.option_narrow', { defaultValue: 'Narrow' })}</option>
                          <option value="default">{t('admin.content_manager.option_default', { defaultValue: 'Default' })}</option>
                          <option value="wide">{t('admin.content_manager.option_wide', { defaultValue: 'Wide' })}</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_background_variant', { defaultValue: 'Background Variant' })}</label>
                        <select value={selectedPresentation.background_variant_token || 'default'} onChange={(event) => updatePresentation({ background_variant_token: event.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
                          <option value="default">{t('admin.content_manager.option_default', { defaultValue: 'Default' })}</option>
                          <option value="hero">{t('admin.content_manager.option_hero', { defaultValue: 'Hero' })}</option>
                          <option value="subtle">{t('admin.content_manager.option_subtle', { defaultValue: 'Subtle' })}</option>
                          <option value="accent">{t('admin.content_manager.option_accent', { defaultValue: 'Accent' })}</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.content_manager.field_padding', { defaultValue: 'Padding' })}</label>
                        <select value={selectedPresentation.padding_token || 'normal'} onChange={(event) => updatePresentation({ padding_token: event.target.value })} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
                          <option value="compact">{t('admin.content_manager.option_compact', { defaultValue: 'Compact' })}</option>
                          <option value="normal">{t('admin.content_manager.option_normal', { defaultValue: 'Normal' })}</option>
                          <option value="spacious">{t('admin.content_manager.option_spacious', { defaultValue: 'Spacious' })}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {(selectedSection.key === 'home.hero' || selectedSection.key === 'home.stats' || selectedSection.key === 'home.how_it_works') && (
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{t('admin.content_manager.actions_section', { defaultValue: 'Actions' })}</h3>
                      {selectedSection.key === 'home.hero' && (
                        <div className="space-y-3">
                          {heroCtas.map((cta, index) => (
                            <div key={cta.id || index} className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-[1fr_1fr_auto_auto]">
                              <input value={cta.label} onChange={(event) => { const next = [...heroCtas]; next[index] = { ...cta, label: event.target.value }; updateCtas(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                              <input value={cta.href} onChange={(event) => { const next = [...heroCtas]; next[index] = { ...cta, href: event.target.value }; updateCtas(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                              <button onClick={() => { const next = [...heroCtas]; next[index] = { ...cta, enabled: !cta.enabled }; updateCtas(next); }} className={`rounded-xl px-3 py-2 text-sm font-medium ${cta.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{cta.enabled ? t('admin.content_manager.enabled', { defaultValue: 'Enabled' }) : t('admin.content_manager.disabled', { defaultValue: 'Disabled' })}</button>
                              <div className="flex gap-1">
                                <button onClick={() => { if (index === 0) return; const next = [...heroCtas]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; updateCtas(next.map((item, idx) => ({ ...item, sort_order: idx + 1 }))); }} className="rounded-lg p-2 text-gray-400 hover:bg-white"><ChevronUp size={16} /></button>
                                <button onClick={() => { if (index === heroCtas.length - 1) return; const next = [...heroCtas]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; updateCtas(next.map((item, idx) => ({ ...item, sort_order: idx + 1 }))); }} className="rounded-lg p-2 text-gray-400 hover:bg-white"><ChevronDown size={16} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedSection.key === 'home.stats' && (
                        <div className="space-y-3">
                          {statsItems.map((item, index) => (
                            <div key={item.id} className="grid gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 md:grid-cols-3">
                              <input value={item.label} onChange={(event) => { const next = [...statsItems]; next[index] = { ...item, label: event.target.value }; updateStatsItems(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                              <input value={item.value} onChange={(event) => { const next = [...statsItems]; next[index] = { ...item, value: event.target.value }; updateStatsItems(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                              <input value={item.icon} onChange={(event) => { const next = [...statsItems]; next[index] = { ...item, icon: event.target.value }; updateStatsItems(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                            </div>
                          ))}
                        </div>
                      )}
                      {selectedSection.key === 'home.how_it_works' && (
                        <div className="space-y-3">
                          {howSteps.map((step, index) => (
                            <div key={step.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                              <div className="mb-3 grid gap-3 md:grid-cols-2">
                                <input value={step.title} onChange={(event) => { const next = [...howSteps]; next[index] = { ...step, title: event.target.value }; updateHowSteps(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                                <input value={step.icon} onChange={(event) => { const next = [...howSteps]; next[index] = { ...step, icon: event.target.value }; updateHowSteps(next); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                              </div>
                              <div className="space-y-2">
                                {step.bullets.map((bullet, bulletIndex) => (
                                  <input
                                    key={`${step.id}-${bulletIndex}`}
                                    value={bullet}
                                    onChange={(event) => {
                                      const next = [...howSteps];
                                      const nextBullets = [...step.bullets];
                                      nextBullets[bulletIndex] = event.target.value;
                                      next[index] = { ...step, bullets: nextBullets };
                                      updateHowSteps(next);
                                    }}
                                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <button onClick={cancelSectionChanges} className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">{t('admin.common.cancel', { defaultValue: 'Cancel' })}</button>
                    <button onClick={publishSection} disabled={!canPublish} className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40">
                      {t('admin.content_manager.publish_this_section', { defaultValue: 'Publish This Section' })}
                    </button>
                  </div>
                </div>);
}
