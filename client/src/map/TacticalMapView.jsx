import { useEffect, useImperativeHandle, useRef } from 'react';
import { TacticalRenderer } from './tacticalRenderer.js';
import './map.css';

/**
 * Canvas battle map. Props follow docs/CONTRACTS.md ("Client renderers"), plus:
 *   showGrid (default true), className, style.
 * Ref API: ref.current.centerOn(tokenId, { zoom? }), fit(), zoomBy(factor), centerOnCell(x, y), renderer.
 */
export function TacticalMapView({ ref, className = '', style, ...props }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rRef = useRef(null);

  useEffect(() => {
    const r = new TacticalRenderer(canvasRef.current, wrapRef.current);
    rRef.current = r;
    return () => {
      r.destroy();
      rRef.current = null;
    };
  }, []);

  // push every render's props into the engine (it diffs internally and only redraws when needed)
  useEffect(() => {
    rRef.current?.setProps(props);
  });

  useImperativeHandle(
    ref,
    () => ({
      centerOn: (id, opts) => rRef.current?.centerOn(id, opts) ?? false,
      centerOnCell: (x, y) => rRef.current?.centerOnCell(x, y),
      fit: () => rRef.current?.fit(true),
      zoomBy: (f) => rRef.current?.zoomBy(f),
      get renderer() {
        return rRef.current;
      },
    }),
    [],
  );

  const name = props.map?.name;
  return (
    <div ref={wrapRef} className={`rp-map-tactical ${className}`} style={style}>
      <canvas ref={canvasRef} className="rp-map-canvas" tabIndex={0} aria-label={name ? `Battle map: ${name}` : 'Battle map'} />
    </div>
  );
}

export default TacticalMapView;
