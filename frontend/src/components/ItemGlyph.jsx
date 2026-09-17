import { FURNITURE_IMAGES } from '../furnitureImages.js';

export default function ItemGlyph({ iconKey, color, rotation = 0, isometric = false }) {
  const image = FURNITURE_IMAGES[iconKey];
  const visualRotation = rotation - (isometric ? 45 : 0);
  const style = {
    '--glyph-color': color,
    '--glyph-rotation': `${visualRotation}deg`,
    transform: `rotateZ(${visualRotation}deg)`,
    transformOrigin: 'center center',
  };

  if (image) {
    return (
      <div className="glyph glyph-image-wrap">
        <img src={image} alt={iconKey} className="glyph-image glyph-rotated" style={style} />
      </div>
    );
  }

  return (
    <div className={`glyph glyph-${iconKey} glyph-rotated`} style={style}>
      <span className="glyph-shape" />
    </div>
  );
}