'use client';

import React, { useState, useMemo } from 'react';
import { MessageSquare, Phone, X, Send, Copy, Check } from 'lucide-react';
import { formatDeliveryMessage } from '@/app/utils/messageTemplate';
import { addManualCustomerLog } from '@/app/admin/actions';
import { useToast } from '@/app/components/ToastProvider';

interface CustomerMessageModalProps {
  open: boolean;
  onClose: () => void;
  customer: {
    id: string;
    full_name: string;
    phone_number?: string | null;
    delivery_address?: string | null;
    remaining_meals?: number;
    cycle_end_date?: string | null;
    total_credits?: number | null;
  };
  customTemplates?: Array<{ id: string; title: string; template: string }>;
}

export function cleanPhoneDigits(phone: string | null | undefined): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

export default function CustomerMessageModal({
  open,
  onClose,
  customer,
  customTemplates = [],
}: CustomerMessageModalProps) {
  const { showToast } = useToast();
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>('remaining');
  const [copied, setCopied] = useState(false);

  const cleanPhone = useMemo(() => cleanPhoneDigits(customer.phone_number), [customer.phone_number]);
  const isSmsPreferred = Boolean(customer.phone_number && /^SMS:/i.test(customer.phone_number.trim()));

  const templates = useMemo(() => {
    return [
      {
        key: 'remaining',
        label: '🔢 Meals Remaining',
        text: 'Hi {customer_name}, you currently have {remaining_meals} meals remaining in your active tiffin plan.',
      },
      {
        key: 'end_date',
        label: '📅 Cycle End Date',
        text: 'Hi {customer_name}, your current tiffin cycle is scheduled through {cycle_end_date}.',
      },
      {
        key: 'summary',
        label: '📋 Full Balance Summary',
        text: 'Hi {customer_name}, you have {remaining_meals} meals remaining. Your cycle runs until {cycle_end_date}.',
      },
      {
        key: 'renewal',
        label: '💳 Renewal Notice',
        text: 'Hi {customer_name}, your cycle finishes on {cycle_end_date}. Please let us know if you would like to renew your service for the next cycle!',
      },
      ...customTemplates.map(t => ({
        key: t.id,
        label: t.title,
        text: t.template,
      })),
    ];
  }, [customTemplates]);

  const resolvedInitialText = useMemo(() => {
    const tpl = templates.find(t => t.key === selectedTemplateKey)?.text || templates[0].text;
    return formatDeliveryMessage(tpl, {
      customer_name: customer.full_name,
      address: customer.delivery_address || '',
      remaining_meals: customer.remaining_meals ?? 0,
      cycle_end_date: customer.cycle_end_date || 'N/A',
      total_credits: customer.total_credits ?? 20,
    });
  }, [selectedTemplateKey, templates, customer]);

  const [messageDraft, setMessageDraft] = useState<string>(resolvedInitialText);

  // Sync draft when template changes
  const handleSelectTemplate = (key: string) => {
    setSelectedTemplateKey(key);
    const tpl = templates.find(t => t.key === key)?.text || '';
    setMessageDraft(
      formatDeliveryMessage(tpl, {
        customer_name: customer.full_name,
        address: customer.delivery_address || '',
        remaining_meals: customer.remaining_meals ?? 0,
        cycle_end_date: customer.cycle_end_date || 'N/A',
        total_credits: customer.total_credits ?? 20,
      })
    );
  };

  if (!open) return null;

  const handleSend = async (channel: 'whatsapp' | 'sms') => {
    if (!cleanPhone) {
      showToast('No phone number on file', 'error');
      return;
    }

    // 1. Log communication audit entry
    void addManualCustomerLog({
      customerId: customer.id,
      summary: `Sent message (${channel.toUpperCase()}): "${messageDraft.slice(0, 80)}..."`,
      actionType: 'NOTE',
      date: new Date().toISOString().slice(0, 10),
    });

    // 2. Open communication link
    if (channel === 'whatsapp') {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageDraft)}`, '_blank');
    } else {
      window.location.href = `sms:${cleanPhone}?&body=${encodeURIComponent(messageDraft)}`;
    }

    showToast(`Opening ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} composer...`);
    onClose();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(messageDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast('Copied to clipboard');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-2xs">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-lg overflow-hidden flex flex-col space-y-4 p-5 animate-in fade-in zoom-in-95">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-black text-gray-900 tracking-tight flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#5D5FEF]" />
              <span>Send Customer Update</span>
            </h3>
            <p className="text-xs text-gray-500 font-medium mt-0.5">
              To <strong className="text-gray-800">{customer.full_name}</strong> {cleanPhone ? `(${customer.phone_number})` : '(No phone)'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Template Selector Strip */}
        <div>
          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
            Select Inquiry / Message Template
          </label>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
            {templates.map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => handleSelectTemplate(t.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  selectedTemplateKey === t.key
                    ? 'bg-[#5D5FEF] text-white border-[#5D5FEF] shadow-xs'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editable Message Box */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              Message Text (Editable)
            </label>
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <textarea
            rows={4}
            value={messageDraft}
            onChange={e => setMessageDraft(e.target.value)}
            className="w-full text-xs font-medium p-3 border border-gray-200 rounded-xl outline-none focus:border-[#5D5FEF] text-gray-800 leading-relaxed bg-slate-50/50 resize-none"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-gray-600 font-bold rounded-xl text-xs hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {isSmsPreferred ? (
              <button
                type="button"
                onClick={() => handleSend('sms')}
                disabled={!cleanPhone}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Send SMS</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend('whatsapp')}
                disabled={!cleanPhone}
                className="px-4 py-2 bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Send via WhatsApp</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}