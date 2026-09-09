import { useEffect, useState } from 'react';
import { getClasses } from './api';
import BookingFlow from './components/BookingFlow';
import RosterPanel from './components/RosterPanel';
import './App.css';

export default function App() {
  const [classes, setClasses] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  async function refresh() {
    try {
      setClasses(await getClasses());
    } catch {
      /* surfaced inline by each panel's own error handling */
    }
    setRefreshKey((k) => k + 1);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="wrap">
      <div className="header">
        <h1>🎓 Ottodot Trial Booking</h1>
        <p className="sub">
          Trial classes are capped at 4 confirmed students. Book a seat, then complete (or
          decline) mock payment — only one parent can ever win the last seat.
        </p>
      </div>
      <BookingFlow classes={classes} onBooked={refresh} />
      <RosterPanel classes={classes} refreshKey={refreshKey} />
    </div>
  );
}
