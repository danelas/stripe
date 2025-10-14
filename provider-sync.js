import pkg from 'pg';
const { Pool } = pkg;

// Connection to your existing provider database
const providerPool = new Pool({
  connectionString: process.env.PROVIDER_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Sync providers from your existing database to payment service
 */
export async function syncProvidersFromMainDatabase() {
  try {
    console.log('Connecting to your provider database...');
    
    // Query your existing provider database (email column may not exist)
    const result = await providerPool.query(`
      SELECT 
        id,
        name,
        phone,
        created_at
      FROM providers 
      WHERE active = true OR active IS NULL
      ORDER BY created_at DESC
    `);
    
    console.log(`Found ${result.rows.length} providers in your database`);
    
    const syncResults = [];
    let successCount = 0;
    let errorCount = 0;
    
    // Import createProvider from your payment service
    const { createProvider } = await import('./db.js');
    
    for (const provider of result.rows) {
      try {
        // Create provider in payment service database
        const syncedProvider = await createProvider(
          `${provider.id}@goldtouchmobile.com`, // Generate email since column doesn't exist
          provider.id,
          provider.name,
          provider.phone
        );
        
        syncResults.push({
          id: provider.id,
          name: provider.name,
          status: 'success',
          synced_provider: syncedProvider
        });
        
        successCount++;
        console.log(`✅ Synced provider: ${provider.name} (${provider.id})`);
        
      } catch (error) {
        syncResults.push({
          id: provider.id,
          name: provider.name,
          status: 'error',
          error: error.message
        });
        
        errorCount++;
        console.error(`❌ Failed to sync provider ${provider.id}:`, error.message);
      }
    }
    
    console.log(`\n🎯 Sync Complete:`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Total: ${result.rows.length}`);
    
    return {
      success: true,
      total: result.rows.length,
      successful: successCount,
      errors: errorCount,
      results: syncResults
    };
    
  } catch (error) {
    console.error('Error syncing providers:', error);
    throw error;
  }
}

/**
 * Get provider data from your main database
 */
export async function getProviderFromMainDatabase(providerId) {
  try {
    const result = await providerPool.query(
      'SELECT * FROM providers WHERE id = $1',
      [providerId]
    );
    
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting provider from main database:', error);
    throw error;
  }
}

/**
 * Test connection to your provider database
 */
export async function testProviderDatabaseConnection() {
  try {
    const result = await providerPool.query('SELECT COUNT(*) as count FROM providers');
    console.log(`✅ Connected to provider database. Found ${result.rows[0].count} providers.`);
    return { success: true, count: result.rows[0].count };
  } catch (error) {
    console.error('❌ Failed to connect to provider database:', error);
    return { success: false, error: error.message };
  }
}
