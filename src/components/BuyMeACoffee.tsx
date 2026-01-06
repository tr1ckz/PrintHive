import './BuyMeACoffee.css';

interface BuyMeACoffeeProps {
  username?: string;
}

function BuyMeACoffee({ 
  username = 'tr1ck'
}: BuyMeACoffeeProps) {
  
  const handleClick = () => {
    window.open(`https://www.buymeacoffee.com/${username}`, '_blank');
  };

  return (
    <button className="bmc-button" onClick={handleClick}>
      <img src="/images/bmc-brand-logo.png" alt="Buy Me a Coffee" className="bmc-logo" />
    </button>
  );
}

export default BuyMeACoffee;
