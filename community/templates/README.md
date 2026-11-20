# Folio community templates

The templates Folio shows under **Community** in its template gallery. Folio reads `index.json` from this folder
(Settings: `templateGallery` can point to any other index with the same shape).

## Add a template

1. Write a page in Folio and use **Save this page as a template**, or write a `.md` file by hand.
2. Keep it general: no names, no private data. Use variables where they help: `{{title}}`, `{{date}}`,
   `{{date:dddd D MMMM YYYY}}`, `{{time}}`, `{{cursor}}`.
3. Describe it in a `template:` map at the top of its front matter (it never reaches pages made from it):

   ```yaml
   ---
   template:
     description: One line on what it is for
     category: Product
   tags: [prd]
   ---
   ```

4. Add it to `index.json` (`id`, `name`, `description`, `category`, `icon`, `author`, `file`) and open a pull request.

Templates are plain Markdown, so they also work in Obsidian, GitHub and any editor.
