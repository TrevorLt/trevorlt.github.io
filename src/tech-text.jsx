import { createRoot } from 'react-dom/client';
import TechText from './reactbits/TechText.jsx';

document.querySelectorAll('[data-tech-text]').forEach(host => {
  const style = getComputedStyle(host);
  const isHero = host.classList.contains('hero-tech-mount');
  const fontSize = Number.parseFloat(style.fontSize);
  const tracking = style.letterSpacing === 'normal' ? -0.05 : Number.parseFloat(style.letterSpacing) / fontSize;
  const align = ['left', 'center', 'right'].includes(style.textAlign) ? style.textAlign : 'left';
  createRoot(host).render(
    <TechText text={host.dataset.techText} fontFamily={style.fontFamily} fontWeight={Number.parseInt(style.fontWeight, 10) || 600}
      fontSize={fontSize} letterSpacing={tracking} align={align} color={style.color} accentColor={style.color}
      sweep={isHero} reveal={isHero ? 'letter' : 'none'} />
  );
});
