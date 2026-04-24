import { useState } from 'react';
import { X, Plus, Trash2, Edit3, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { Vibe, Strain, createStrain, createVibe } from './types';

interface VibeEditorProps {
  vibes: Vibe[];
  onUpdate: (vibes: Vibe[]) => void;
  onClose: () => void;
}

export function VibeEditor({ vibes, onUpdate, onClose }: VibeEditorProps) {
  const [editingVibeId, setEditingVibeId] = useState<string | null>(null);
  const [renamingVibeId, setRenamingVibeId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [newVibeName, setNewVibeName] = useState('');

  const updateVibe = (id: string, patch: Partial<Vibe>) => {
    onUpdate(vibes.map(v => v.id === id ? { ...v, ...patch } : v));
  };

  const deleteVibe = (id: string) => {
    onUpdate(vibes.filter(v => v.id !== id));
    if (editingVibeId === id) setEditingVibeId(null);
  };

  const addStrain = (vibeId: string) => {
    const vibe = vibes.find(v => v.id === vibeId);
    if (!vibe) return;
    updateVibe(vibeId, { strains: [...vibe.strains, createStrain('New strain', 1.0)] });
  };

  const updateStrain = (vibeId: string, strainId: string, patch: Partial<Strain>) => {
    const vibe = vibes.find(v => v.id === vibeId);
    if (!vibe) return;
    updateVibe(vibeId, {
      strains: vibe.strains.map(s => s.id === strainId ? { ...s, ...patch } : s)
    });
  };

  const removeStrain = (vibeId: string, strainId: string) => {
    const vibe = vibes.find(v => v.id === vibeId);
    if (!vibe) return;
    updateVibe(vibeId, { strains: vibe.strains.filter(s => s.id !== strainId) });
  };

  const addVibe = () => {
    const name = newVibeName.trim() || 'New Vibe';
    const vibe = createVibe(name, [createStrain('ambient', 1.0)]);
    onUpdate([...vibes, vibe]);
    setNewVibeName('');
    setEditingVibeId(vibe.id);
  };

  const startRename = (vibe: Vibe) => {
    setRenamingVibeId(vibe.id);
    setRenameText(vibe.name);
  };

  const finishRename = () => {
    if (renamingVibeId && renameText.trim()) {
      updateVibe(renamingVibeId, { name: renameText.trim() });
    }
    setRenamingVibeId(null);
  };

  const editingVibe = vibes.find(v => v.id === editingVibeId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[70] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
      onClick={onClose}
    >
      <div
        className="max-w-md w-full bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <h3 className="text-sm font-bold uppercase tracking-widest">Edit Vibes</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {vibes.map(vibe => (
            <div key={vibe.id} className="border-b border-white/5">
              <div className="flex items-center gap-2 p-3 hover:bg-white/5">
                {renamingVibeId === vibe.id ? (
                  <input
                    autoFocus
                    value={renameText}
                    onChange={e => setRenameText(e.target.value)}
                    onBlur={finishRename}
                    onKeyDown={e => e.key === 'Enter' && finishRename()}
                    className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
                  />
                ) : (
                  <button
                    onClick={() => setEditingVibeId(editingVibeId === vibe.id ? null : vibe.id)}
                    className="flex-1 text-left text-xs"
                  >
                    <span className="font-medium">{vibe.name}</span>
                    <span className="text-white/30 ml-2">{vibe.strains.length} strain{vibe.strains.length !== 1 ? 's' : ''}</span>
                  </button>
                )}
                <button onClick={() => startRename(vibe)} className="p-1 hover:bg-white/10 rounded transition-colors">
                  <Edit3 className="w-3 h-3 text-white/30" />
                </button>
                <button onClick={() => deleteVibe(vibe.id)} className="p-1 hover:bg-red-500/20 rounded transition-colors">
                  <Trash2 className="w-3 h-3 text-red-400/50" />
                </button>
              </div>

              {editingVibeId === vibe.id && (
                <div className="px-3 pb-3 space-y-2">
                  {vibe.strains.map(strain => (
                    <div key={strain.id} className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
                      <input
                        value={strain.text}
                        onChange={e => updateStrain(vibe.id, strain.id, { text: e.target.value })}
                        className="flex-1 bg-transparent text-xs focus:outline-none placeholder-white/20"
                        placeholder="Prompt text..."
                      />
                      <button
                        onClick={() => removeStrain(vibe.id, strain.id)}
                        className="p-1 hover:bg-red-500/20 rounded transition-colors"
                      >
                        <X className="w-3 h-3 text-white/30" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => addStrain(vibe.id)}
                    className="w-full py-1.5 border border-dashed border-white/10 rounded-lg text-[10px] uppercase tracking-widest text-white/30 hover:text-white/50 hover:border-white/20 transition-colors flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3 h-3" /> Add Strain
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-white/5">
          <div className="flex gap-2">
            <input
              value={newVibeName}
              onChange={e => setNewVibeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addVibe()}
              placeholder="New vibe name..."
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 placeholder-white/20"
            />
            <button
              onClick={addVibe}
              className="px-4 py-2 bg-emerald-500 text-black rounded-lg text-xs font-bold hover:bg-emerald-400 transition-colors flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
