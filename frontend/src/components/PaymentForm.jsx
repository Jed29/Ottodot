import { useState } from 'react';

export default function PaymentForm({ bookingId, studentName, parentName, busy, onPay }) {
  const [simulateFail, setSimulateFail] = useState(false);

  return (
    <div className="payment-card">
      <div className="payment-card-header">
        <span>Mock payment</span>
        <span className="payment-amount">Rp 99.000</span>
      </div>

      <label>Cardholder name (fetched from the selected child's parent)</label>
      <input type="text" value={parentName || ''} readOnly disabled />

      <label>Card number (dummy — no real gateway)</label>
      <input type="text" placeholder="4242 4242 4242 4242" disabled />

      <div className="row">
        <div className="field">
          <label>Expiry</label>
          <input type="text" placeholder="12/29" disabled />
        </div>
        <div className="field">
          <label>CVC</label>
          <input type="text" placeholder="123" disabled />
        </div>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={simulateFail}
          onChange={(e) => setSimulateFail(e.target.checked)}
        />
        Simulate a declined payment (demo)
      </label>

      <button
        disabled={busy}
        className={simulateFail ? 'danger' : ''}
        onClick={() => onPay(simulateFail ? 'fail' : 'success')}
      >
        {busy ? 'Processing…' : simulateFail ? 'Pay Rp 99.000 (will decline)' : 'Pay Rp 99.000'}
      </button>

      <p className="payment-note">
        Booking #{bookingId} for {studentName} — card number/expiry/CVC are decorative demo
        values, only the cardholder name above is real fetched data. This step only exercises
        the mock payment status (<code>simulate: success|fail</code>), no real gateway.
      </p>
    </div>
  );
}
