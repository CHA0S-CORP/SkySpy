import React, { useState } from 'react';
import { Info, Plane, Building2, Hash, Camera, Database, ChevronDown, ChevronRight } from 'lucide-react';

// Human-readable source names
const SOURCE_LABELS = {
  faa: 'FAA Registry',
  adsbx: 'ADS-B Exchange',
  tar1090: 'tar1090-db',
  opensky: 'OpenSky Network',
  hexdb: 'HexDB',
  adsblol: 'adsb.lol',
  planespotters: 'Planespotters',
};

// Fields to display in source comparison
const COMPARISON_FIELDS = [
  { key: 'registration', label: 'Registration' },
  { key: 'type_code', label: 'Type Code' },
  { key: 'type_name', label: 'Type Name' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'serial_number', label: 'Serial #' },
  { key: 'year_built', label: 'Year Built' },
  { key: 'operator', label: 'Operator' },
  { key: 'operator_icao', label: 'Operator ICAO' },
  { key: 'owner', label: 'Owner' },
  { key: 'country', label: 'Country' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
];

export function InfoTab({ info, hex, photoInfo }) {
  const [expandedSources, setExpandedSources] = useState({});
  const [showSourceComparison, setShowSourceComparison] = useState(false);

  if (!info) {
    return (
      <div className="detail-empty" role="status">
        <Info size={48} aria-hidden="true" />
        <p>No aircraft information available</p>
        <span>Data may not be available for this aircraft</span>
      </div>
    );
  }

  // Extract source_data from info (new per-source data format)
  const sourceData = info.source_data || [];
  const hasSourceData = sourceData.length > 0;

  const toggleSource = (source) => {
    setExpandedSources(prev => ({
      ...prev,
      [source]: !prev[source]
    }));
  };

  // Normalize field names to handle different API response formats
  const normalized = {
    // Airframe fields - handle both snake_case and various API formats
    type_name: info.type_name || info.aircraft_type || info.type || info.t,
    type_code: info.type_code || info.icao_type || info.icaoAircraftType,
    manufacturer: info.manufacturer || info.manufacturerName,
    model: info.model || info.modelName,
    serial_number: info.serial_number || info.serialNumber || info.manufacturerSerial,
    year_built: info.year_built || info.yearBuilt || info.built,
    age_years: info.age_years || info.ageYears || (info.year_built ? new Date().getFullYear() - info.year_built : null),

    // Operator fields
    operator: info.operator || info.operatorName || info.owner_operator,
    operator_icao: info.operator_icao || info.operatorIcao || info.airline_icao,
    owner: info.owner || info.ownerName || info.registered_owner,
    country: info.country || info.countryName || info.registered_country,

    // Registration fields
    registration: info.registration || info.tail_number || info.reg || info.r,
    is_military: info.is_military ?? info.military ?? info.isMilitary ?? false,
    category: info.category || info.aircraftCategory,
  };

  return (
    <div
      className="detail-info-grid"
      id="panel-info"
      role="tabpanel"
      aria-labelledby="tab-info"
    >
      {/* Airframe Section */}
      <section className="info-section" aria-labelledby="airframe-heading">
        <h3 id="airframe-heading">
          <Plane size={16} aria-hidden="true" /> Airframe
        </h3>
        <div className="info-rows">
          {normalized.type_name && (
            <div className="info-row">
              <span>Type</span>
              <span>{normalized.type_name}</span>
            </div>
          )}
          {normalized.type_code && (
            <div className="info-row">
              <span>ICAO Code</span>
              <span>{normalized.type_code}</span>
            </div>
          )}
          {normalized.manufacturer && (
            <div className="info-row">
              <span>Manufacturer</span>
              <span>{normalized.manufacturer}</span>
            </div>
          )}
          {normalized.model && (
            <div className="info-row">
              <span>Model</span>
              <span>{normalized.model}</span>
            </div>
          )}
          {normalized.serial_number && (
            <div className="info-row">
              <span>Serial #</span>
              <span>{normalized.serial_number}</span>
            </div>
          )}
          {normalized.year_built && (
            <div className="info-row">
              <span>Year Built</span>
              <span>{normalized.year_built}</span>
            </div>
          )}
          {normalized.age_years && (
            <div className="info-row">
              <span>Age</span>
              <span>{normalized.age_years} years</span>
            </div>
          )}
        </div>
      </section>

      {/* Operator Section */}
      <section className="info-section" aria-labelledby="operator-heading">
        <h3 id="operator-heading">
          <Building2 size={16} aria-hidden="true" /> Operator
        </h3>
        <div className="info-rows">
          {normalized.operator && (
            <div className="info-row">
              <span>Operator</span>
              <span>{normalized.operator}</span>
            </div>
          )}
          {normalized.operator_icao && (
            <div className="info-row">
              <span>ICAO</span>
              <span>{normalized.operator_icao}</span>
            </div>
          )}
          {normalized.owner && (
            <div className="info-row">
              <span>Owner</span>
              <span>{normalized.owner}</span>
            </div>
          )}
          {normalized.country && (
            <div className="info-row">
              <span>Country</span>
              <span>{normalized.country}</span>
            </div>
          )}
        </div>
      </section>

      {/* Registration Section */}
      <section className="info-section" aria-labelledby="registration-heading">
        <h3 id="registration-heading">
          <Hash size={16} aria-hidden="true" /> Registration
        </h3>
        <div className="info-rows">
          {normalized.registration && (
            <div className="info-row">
              <span>Registration</span>
              <span>{normalized.registration}</span>
            </div>
          )}
          <div className="info-row">
            <span>ICAO Hex</span>
            <span>{hex?.toUpperCase()}</span>
          </div>
          {normalized.is_military && (
            <div className="info-row">
              <span>Type</span>
              <span className="badge-military">Military</span>
            </div>
          )}
          {normalized.category && (
            <div className="info-row">
              <span>Category</span>
              <span>{normalized.category}</span>
            </div>
          )}
        </div>
      </section>

      {/* Photo Section */}
      {photoInfo && (
        <section className="info-section" aria-labelledby="photo-heading">
          <h3 id="photo-heading">
            <Camera size={16} aria-hidden="true" /> Photo
          </h3>
          <div className="info-rows">
            {photoInfo.photographer && (
              <div className="info-row">
                <span>Photographer</span>
                <span>{photoInfo.photographer}</span>
              </div>
            )}
            {photoInfo.source && (
              <div className="info-row">
                <span>Source</span>
                <span>{photoInfo.source}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Data Sources Section */}
      {hasSourceData && (
        <section className="info-section info-section-sources" aria-labelledby="sources-heading">
          <h3
            id="sources-heading"
            className="sources-header clickable"
            onClick={() => setShowSourceComparison(!showSourceComparison)}
            role="button"
            aria-expanded={showSourceComparison}
          >
            <Database size={16} aria-hidden="true" />
            Data Sources ({sourceData.length})
            {showSourceComparison ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </h3>

          {showSourceComparison && (
            <div className="source-comparison">
              {/* Source badges */}
              <div className="source-badges">
                {sourceData.map(src => (
                  <span
                    key={src.source}
                    className={`source-badge source-badge-${src.source}`}
                    title={`Last updated: ${src.updated_at ? new Date(src.updated_at).toLocaleString() : 'Unknown'}`}
                  >
                    {SOURCE_LABELS[src.source] || src.source}
                  </span>
                ))}
              </div>

              {/* Comparison table */}
              <div className="source-table-wrapper">
                <table className="source-table">
                  <thead>
                    <tr>
                      <th>Field</th>
                      {sourceData.map(src => (
                        <th key={src.source}>{SOURCE_LABELS[src.source] || src.source}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARISON_FIELDS.map(field => {
                      const values = sourceData.map(src => src[field.key] || src.raw_data?.[field.key]);
                      const hasAnyValue = values.some(v => v != null && v !== '');
                      const allSame = values.every(v => v === values[0]);

                      if (!hasAnyValue) return null;

                      return (
                        <tr key={field.key} className={!allSame ? 'source-row-diff' : ''}>
                          <td className="source-field-label">{field.label}</td>
                          {sourceData.map(src => {
                            const value = src[field.key] || src.raw_data?.[field.key];
                            return (
                              <td key={src.source} className={value ? '' : 'source-empty'}>
                                {value ?? '—'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Individual source details */}
              <div className="source-details">
                {sourceData.map(src => (
                  <div key={src.source} className="source-detail-card">
                    <button
                      className="source-detail-header"
                      onClick={() => toggleSource(src.source)}
                      aria-expanded={expandedSources[src.source]}
                    >
                      {expandedSources[src.source] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className={`source-badge source-badge-${src.source}`}>
                        {SOURCE_LABELS[src.source] || src.source}
                      </span>
                      <span className="source-detail-meta">
                        {src.updated_at && `Updated ${new Date(src.updated_at).toLocaleDateString()}`}
                      </span>
                    </button>

                    {expandedSources[src.source] && (
                      <div className="source-detail-content">
                        <pre className="source-raw-data">
                          {JSON.stringify(src.raw_data || src, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
