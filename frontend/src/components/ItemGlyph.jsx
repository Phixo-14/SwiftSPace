import { FURNITURE_IMAGES } from '../furnitureImages.js';

export default function ItemGlyph({
  iconKey,
  color,
  rotation = 0,
  objectPosition = '50% 50%',
  footprintWidth = 1,
  footprintLength = 1,
}) {
  const image = FURNITURE_IMAGES[iconKey];
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const rotatedWidth = Math.max(0.25, footprintWidth * cosine + footprintLength * sine);
  const rotatedLength = Math.max(0.25, footprintWidth * sine + footprintLength * cosine);
  const style = {
    '--glyph-color': color,
    '--glyph-rotation': `${rotation}deg`,
    objectPosition,
    transform: `rotateZ(${rotation}deg)`,
    transformOrigin: 'center center',
  };

  if (image) {
    return (
      <div className="glyph glyph-image-wrap">
        <img
          src={image}
          alt={iconKey}
          className="glyph-image glyph-rotated"
          style={{
            ...style,
            width: `${(footprintWidth / rotatedWidth) * 100}%`,
            height: `${(footprintLength / rotatedLength) * 100}%`,
          }}
        />
      </div>
    );
  }

  return (
    <div className={`glyph glyph-${iconKey} glyph-rotated`} style={style}>
      <span className="glyph-shape" />
    </div>
  );
}