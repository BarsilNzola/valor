import WDK from '@tetherto/wdk';

// Use type inference instead of explicit typing
async function createAgent() {
  try {
    // Generate random seed phrase - remove the argument if it doesn't accept any
    const phrase = WDK.getRandomSeedPhrase(); // Removed the 24 argument
    console.log('Seed phrase:', phrase);

    // Initialize WDK with the seed phrase
    const wdk = new WDK(phrase);

    // Register EVM wallet and get account
    const evmWalletModule = await import('@tetherto/wdk-wallet-evm');
    const account = await wdk.registerWallet(
      'ethereum', 
      evmWalletModule.default, 
      { provider: 'https://eth.drpc.org' }
    ).getAccount('ethereum', 0);

    // Get and display the agent address
    const address = await account.getAddress();
    console.log('Agent address:', address);
    
    return {
      seedPhrase: phrase,
      wallet: wdk,
      account,
      address
    };
    
  } catch (error) {
    console.error('Error creating agent:', error);
    throw error;
  }
}

// Execute the function
createAgent()
  .then((config) => {
    console.log('Agent created successfully!');
  })
  .catch((error) => {
    console.error('Failed to create agent:', error);
    process.exit(1);
  });