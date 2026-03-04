import { motion } from 'motion/react';

interface InfoModalProps {
  onClose: () => void;
}

export default function InfoModal({ onClose }: InfoModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full bg-[#111] border border-white/10 p-10 rounded-3xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-3xl font-bold mb-6 italic tracking-tighter">HOW TO PLAY</h2>
        <div className="space-y-6 text-white/60 leading-relaxed">
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <span className="text-emerald-500 font-bold">1</span>
            </div>
            <p>Hold your hand in front of the camera. The system tracks your <span className="text-white">index finger tip</span>.</p>
          </div>
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <span className="text-emerald-500 font-bold">2</span>
            </div>
            <p>Move <span className="text-white">Left to Right</span> to control the pitch. The sound will glide between notes but snap to the scale when you pause.</p>
          </div>
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <span className="text-emerald-500 font-bold">3</span>
            </div>
            <p>Move <span className="text-white">Up and Down</span> to control the volume. Higher is louder.</p>
          </div>
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
              <span className="text-emerald-500 font-bold">4</span>
            </div>
            <p>Use <span className="text-white">two hands</span> for polyphonic performance. Each hand can have unique scale and instrument settings.</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-10 w-full py-4 border border-white/10 rounded-xl hover:bg-white/5 transition-colors uppercase tracking-widest text-xs font-bold"
        >
          Close Transmission
        </button>
      </div>
    </motion.div>
  );
}
