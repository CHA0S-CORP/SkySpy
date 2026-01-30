import React, { useState } from 'react';
import { Plane, Search, Loader2 } from 'lucide-react';

// Airport Search component
export function AirportSearch({ onSearch, loading }) {
  const [icao, setIcao] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (icao.trim()) {
      onSearch(icao.trim().toUpperCase());
    }
  };

  return (
    <form className="airport-search" onSubmit={handleSubmit}>
      <div className="search-input-wrapper">
        <Plane size={16} />
        <input
          type="text"
          value={icao}
          onChange={(e) => setIcao(e.target.value.toUpperCase())}
          placeholder="Search by airport (e.g., KJFK)"
          maxLength={4}
        />
      </div>
      <button type="submit" disabled={loading || !icao.trim()}>
        {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
        <span>Search</span>
      </button>
    </form>
  );
}

export default AirportSearch;
