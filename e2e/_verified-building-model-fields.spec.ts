import { test, expect } from '@playwright/test'

test.describe('Building Model Fields', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  async function checkNoHorizontalOverflow(page: any) {
    const result = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth + 1)
  }

  test('Scenario 1: Base model state before any messages', async ({ page }) => {
    await expect(page.getByTestId('model-state')).toBeVisible()
    
    const modelStateText = await page.getByTestId('model-state').textContent()
    expect(modelStateText).toBe('null')
    
    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    expect(modelStateParsed).toBeNull()
    
    await expect(page.getByText('fel uppstod')).not.toBeVisible()
    await expect(page.getByText(/error/i)).not.toBeVisible()
    await expect(page.getByText('undefined')).not.toBeVisible()
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 2: Base building model extraction', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    
    expect(modelStateParsed.flowType).toBe('komplementbyggnad')
    expect(modelStateParsed.footprint).toEqual({ length: 4.5, width: 4.5 })
    expect(modelStateParsed).not.toHaveProperty('roof')
    expect(modelStateParsed).not.toHaveProperty('wallHeight')
    expect(modelStateParsed).not.toHaveProperty('installations')
    expect(modelStateParsed).not.toHaveProperty('inomDetaljplan')
    expect(modelStateParsed).not.toHaveProperty('distanceToGrans')
    
    const assistantMessage = page.getByTestId('assistant-message')
    await expect(assistantMessage).not.toContainText('fel uppstod')
    await expect(assistantMessage).not.toContainText(/error/i)
    await expect(assistantMessage).not.toContainText('undefined')
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 3: Roof type and pitch extraction', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    const urlBefore = page.url()

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Sadeltak med 25 graders lutning',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })

    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    
    expect(modelStateParsed.roof).toEqual({ type: 'sadel', pitch: 25 })
    expect(modelStateParsed.flowType).toBe('komplementbyggnad')
    expect(modelStateParsed.footprint).toEqual({ length: 4.5, width: 4.5 })
    
    await expect(page).toHaveURL(urlBefore)
    
    const assistantMessage = page.getByTestId('assistant-message').nth(1)
    await expect(assistantMessage).not.toContainText('fel uppstod')
    await expect(assistantMessage).not.toContainText(/error/i)
    await expect(assistantMessage).not.toContainText('undefined')
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 4: Wall height extraction', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Sadeltak med 25 graders lutning',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })

    const urlBefore = page.url()

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Vägghöjd 2.4 meter',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').nth(2)).toBeVisible({
      timeout: 10000,
    })

    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    
    expect(modelStateParsed.wallHeight).toBe(2.4)
    expect(modelStateParsed.flowType).toBe('komplementbyggnad')
    expect(modelStateParsed.footprint).toEqual({ length: 4.5, width: 4.5 })
    expect(modelStateParsed.roof).toEqual({ type: 'sadel', pitch: 25 })
    
    await expect(page).toHaveURL(urlBefore)
    
    const assistantMessage = page.getByTestId('assistant-message').nth(2)
    await expect(assistantMessage).not.toContainText('fel uppstod')
    await expect(assistantMessage).not.toContainText(/error/i)
    await expect(assistantMessage).not.toContainText('undefined')
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 5: Installations extraction (multiple)', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Sadeltak med 25 graders lutning',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Vägghöjd 2.4 meter',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(2)).toBeVisible({
      timeout: 10000,
    })

    const urlBefore = page.url()

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ska ha dusch och avlopp',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').nth(3)).toBeVisible({
      timeout: 10000,
    })

    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    
    expect(modelStateParsed.installations).toEqual(['vatten', 'avlopp'])
    expect(modelStateParsed.flowType).toBe('komplementbyggnad')
    expect(modelStateParsed.footprint).toEqual({ length: 4.5, width: 4.5 })
    expect(modelStateParsed.roof).toEqual({ type: 'sadel', pitch: 25 })
    expect(modelStateParsed.wallHeight).toBe(2.4)
    
    await expect(page).toHaveURL(urlBefore)
    
    const assistantMessage = page.getByTestId('assistant-message').nth(3)
    await expect(assistantMessage).not.toContainText('fel uppstod')
    await expect(assistantMessage).not.toContainText(/error/i)
    await expect(assistantMessage).not.toContainText('undefined')
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 6: Triage context extraction', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Sadeltak med 25 graders lutning',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Vägghöjd 2.4 meter',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(2)).toBeVisible({
      timeout: 10000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ska ha dusch och avlopp',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(3)).toBeVisible({
      timeout: 10000,
    })

    const urlBefore = page.url()

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ligger inom detaljplan, 4 meter från tomtgränsen',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').nth(4)).toBeVisible({
      timeout: 10000,
    })

    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    
    expect(modelStateParsed.inomDetaljplan).toBe(true)
    expect(modelStateParsed.distanceToGrans).toBe(4)
    expect(modelStateParsed.flowType).toBe('komplementbyggnad')
    expect(modelStateParsed.footprint).toEqual({ length: 4.5, width: 4.5 })
    expect(modelStateParsed.roof).toEqual({ type: 'sadel', pitch: 25 })
    expect(modelStateParsed.wallHeight).toBe(2.4)
    expect(modelStateParsed.installations).toEqual(['vatten', 'avlopp'])
    
    await expect(page).toHaveURL(urlBefore)
    
    const assistantMessage = page.getByTestId('assistant-message').nth(4)
    await expect(assistantMessage).not.toContainText('fel uppstod')
    await expect(assistantMessage).not.toContainText(/error/i)
    await expect(assistantMessage).not.toContainText('undefined')
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 7: Cumulative model state after all updates', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Sadeltak med 25 graders lutning',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Vägghöjd 2.4 meter',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(2)).toBeVisible({
      timeout: 10000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ska ha dusch och avlopp',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(3)).toBeVisible({
      timeout: 10000,
    })

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ligger inom detaljplan, 4 meter från tomtgränsen',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(4)).toBeVisible({
      timeout: 10000,
    })

    const modelStateParsed = await page.evaluate(() => {
      const modelState = document.querySelector('[data-testid="model-state"]')
      return JSON.parse(modelState.textContent)
    })
    
    const expectedFields = [
      'flowType',
      'footprint',
      'roof',
      'wallHeight',
      'installations',
      'inomDetaljplan',
      'distanceToGrans',
    ]
    expectedFields.forEach(field => {
      expect(modelStateParsed).toHaveProperty(field)
    })
    
    expect(modelStateParsed.flowType).toBe('komplementbyggnad')
    expect(modelStateParsed.footprint).toEqual({ length: 4.5, width: 4.5 })
    expect(modelStateParsed.roof).toEqual({ type: 'sadel', pitch: 25 })
    expect(modelStateParsed.wallHeight).toBe(2.4)
    expect(modelStateParsed.installations).toEqual(['vatten', 'avlopp'])
    expect(modelStateParsed.inomDetaljplan).toBe(true)
    expect(modelStateParsed.distanceToGrans).toBe(4)
    
    await expect(page.getByTestId('assistant-message')).toHaveCount(5)
    
    await checkNoHorizontalOverflow(page)
  })

  test('Scenario 8: Mobile viewport constraint (all scenarios)', async ({ page }) => {
    await checkNoHorizontalOverflow(page)

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })
    await checkNoHorizontalOverflow(page)

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Sadeltak med 25 graders lutning',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })
    await checkNoHorizontalOverflow(page)

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Vägghöjd 2.4 meter',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(2)).toBeVisible({
      timeout: 10000,
    })
    await checkNoHorizontalOverflow(page)

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ska ha dusch och avlopp',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(3)).toBeVisible({
      timeout: 10000,
    })
    await checkNoHorizontalOverflow(page)

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Den ligger inom detaljplan, 4 meter från tomtgränsen',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()
    await expect(page.getByTestId('assistant-message').nth(4)).toBeVisible({
      timeout: 10000,
    })
    await checkNoHorizontalOverflow(page)

    await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
    await expect(page.getByPlaceholder('Beskriv vad du vill bygga...')).toBeVisible()
    await expect(page.getByTestId('model-state')).toBeVisible()
  })
})
