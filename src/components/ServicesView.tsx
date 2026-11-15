import { useState } from 'react';
import { Plus, Edit3, Power } from 'lucide-react';
import { api } from '../lib/api';
import { centsToInputString, formatPeso, getCategoryLabel, parseToCentavos } from '../lib/money';
import type { ServiceCategory, ServiceItem } from '../types';

interface Props {
  services: ServiceItem[];
  onDataChanged: () => void;
}

export function ServicesView({ services, onDataChanged }: Props) {
  const [catFilter, setCatFilter] = useState<'all' | ServiceCategory>('all');
  const [editingId, setEditingId] = useState<number | null>(null);

  const [serviceName, setServiceName] = useState('');
  const [category, setCategory] = useState<ServiceCategory>('loading');
  const [provider, setProvider] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [actualCost, setActualCost] = useState('0.00');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filtered =
    catFilter === 'all' ? services : services.filter((s) => s.category === catFilter);

  const resetForm = () => {
    setEditingId(null);
    setServiceName('');
    setCategory('loading');
    setProvider('');
    setDefaultPrice('');
    setActualCost('0.00');
    setDescription('');
    setError('');
  };

  const startEdit = (s: ServiceItem) => {
    setEditingId(s.id);
    setServiceName(s.service_name);
    setCategory(s.category);
    setProvider(s.provider || '');
    setDefaultPrice(centsToInputString(s.default_price_cents));
    setActualCost(centsToInputString(s.actual_cost_cents));
    setDescription(s.description || '');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const payload = {
        service_name: serviceName,
        category,
        provider: provider.trim() || null,
        default_price_cents: parseToCentavos(defaultPrice),
        actual_cost_cents: parseToCentavos(actualCost),
        description: description.trim() || null,
      };
      if (editingId) {
        await api.updateService(editingId, payload);
      } else {
        await api.createService(payload);
      }
      resetForm();
      onDataChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (s: ServiceItem) => {
    await api.toggleServiceStatus(s.id, s.status === 'active' ? 'inactive' : 'active');
    onDataChanged();
  };

  const priceCents = parseToCentavos(defaultPrice);
  const costCents = parseToCentavos(actualCost);
  const marginCents = priceCents - costCents;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Services &amp; Pricing Catalog</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure loading products, printing rates, and custom extra services. Updating prices never modifies historical transactions.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              {editingId ? 'Edit Service Pricing' : 'Add New Service / Product'}
            </h3>
            {editingId && (
              <button type="button" onClick={resetForm} className="text-xs text-slate-500 hover:text-slate-900">
                Cancel Edit
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ServiceCategory)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            >
              <option value="loading">Loading (Mobile &amp; TV Cable)</option>
              <option value="cash_in_out">Cash-in / Cash-out</option>
              <option value="printing">Printing / Photocopy</option>
              <option value="extra_services">Extra Services</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Service / Product Name</label>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="e.g. Globe Go50, 2x2 ID Picture, Resume Making"
              required
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Network / Provider (Optional)
            </label>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="e.g. Globe, Smart, GCash, Maya"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Selling Price / Fee (₱)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
                placeholder="0.00"
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Actual Cost (₱)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actualCost}
                onChange={(e) => setActualCost(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg money"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short service note"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex justify-between text-xs">
            <span className="text-slate-600">Estimated Margin / Profit</span>
            <span className={`font-bold money ${marginCents >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {formatPeso(marginCents)}
            </span>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Saving...' : editingId ? 'Update Service' : 'Save Service'}
          </button>
        </form>

        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">Configured Services ({filtered.length})</h3>
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'loading', label: 'Loading' },
                  { id: 'cash_in_out', label: 'Cash-in/out' },
                  { id: 'printing', label: 'Printing' },
                  { id: 'extra_services', label: 'Extra' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setCatFilter(t.id)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    catFilter === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Service Name</th>
                  <th className="py-2.5 px-4 font-medium">Category</th>
                  <th className="py-2.5 px-4 font-medium text-right">Price / Fee</th>
                  <th className="py-2.5 px-4 font-medium text-right">Cost</th>
                  <th className="py-2.5 px-4 font-medium text-right">Profit</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filtered.map((s) => (
                  <tr key={s.id} className={s.status === 'inactive' ? 'opacity-50' : 'hover:bg-slate-50'}>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{s.service_name}</div>
                      {s.provider && <div className="text-[11px] text-slate-500">{s.provider}</div>}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                      {getCategoryLabel(s.category)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-slate-900 money whitespace-nowrap">
                      {formatPeso(s.default_price_cents)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-600 money whitespace-nowrap">
                      {formatPeso(s.actual_cost_cents)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold text-emerald-700 money whitespace-nowrap">
                      {formatPeso(s.default_price_cents - s.actual_cost_cents)}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`font-semibold ${
                          s.status === 'active' ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {s.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => startEdit(s)}
                          className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-950 font-medium"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggle(s)}
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-950"
                        >
                          <Power className="w-3.5 h-3.5" />
                          {s.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
