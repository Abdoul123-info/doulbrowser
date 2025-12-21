from PIL import Image
import sys

def remove_background(input_path, output_path):
    """Remove white/light background from image and make it transparent"""
    # Open image
    img = Image.open(input_path).convert("RGBA")
    
    # Get data
    datas = img.getdata()
    
    new_data = []
    for item in datas:
        # Change all white (also shades) to transparent
        # Adjust threshold as needed (currently 240 for near-white)
        if item[0] > 240 and item[1] > 240 and item[2] > 240:
            new_data.append((255, 255, 255, 0))  # Transparent
        else:
            new_data.append(item)
    
    img.putdata(new_data)
    img.save(output_path, "PNG")
    print(f"✅ Saved transparent icon to: {output_path}")

if __name__ == "__main__":
    input_file = r"C:\Users\ABDOUL JABBAR\Desktop\Nouveau dossier\logi\build\icon.png"
    output_file = r"C:\Users\ABDOUL JABBAR\Desktop\Nouveau dossier\logi\build\icon_transparent.png"
    
    remove_background(input_file, output_file)
