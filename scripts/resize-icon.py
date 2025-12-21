from PIL import Image
import os

def resize_icon_to_fill(input_path, output_path, target_size=512, fill_percentage=0.75):
    """
    Resize icon to fill more space while maintaining transparency
    
    Args:
        input_path: Path to input PNG
        output_path: Path to save resized PNG
        target_size: Final canvas size (default 512x512)
        fill_percentage: How much of canvas to fill (0.75 = 75%)
    """
    print(f"📂 Opening: {input_path}")
    
    # Open the image
    img = Image.open(input_path).convert("RGBA")
    
    # Get the bounding box of non-transparent pixels
    bbox = img.getbbox()
    
    if bbox:
        # Crop to content
        img_cropped = img.crop(bbox)
        print(f"✂️  Cropped from {img.size} to {img_cropped.size}")
        
        # Calculate new size (fill 75% of canvas)
        target_content_size = int(target_size * fill_percentage)
        
        # Maintain aspect ratio
        width, height = img_cropped.size
        if width > height:
            new_width = target_content_size
            new_height = int((height / width) * target_content_size)
        else:
            new_height = target_content_size
            new_width = int((width / height) * target_content_size)
        
        # Resize the content
        img_resized = img_cropped.resize((new_width, new_height), Image.Resampling.LANCZOS)
        print(f"🔍 Resized to: {img_resized.size}")
        
        # Create new canvas
        canvas = Image.new('RGBA', (target_size, target_size), (255, 255, 255, 0))
        
        # Center the resized image
        x_offset = (target_size - new_width) // 2
        y_offset = (target_size - new_height) // 2
        
        canvas.paste(img_resized, (x_offset, y_offset), img_resized)
        
        # Save
        canvas.save(output_path, 'PNG')
        print(f"✅ Saved enlarged icon to: {output_path}")
        print(f"📏 Final size: {canvas.size}, Content fills ~{int(fill_percentage*100)}% of space")
        
    else:
        print("❌ No content found in image!")

if __name__ == "__main__":
    input_file = r"C:\Users\ABDOUL JABBAR\Desktop\Nouveau dossier\logi\resources\icon-removebg-preview.png"
    output_file = r"C:\Users\ABDOUL JABBAR\Desktop\Nouveau dossier\logi\resources\icon.png"
    
    # Resize to fill 75% of the 512x512 canvas
    resize_icon_to_fill(input_file, output_file, target_size=512, fill_percentage=0.75)
    
    print("\n🔄 Next steps:")
    print("1. node scripts\\generate-ico.js")
    print("2. npx electron-builder --dir --win")
